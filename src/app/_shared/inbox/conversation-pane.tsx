'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { Database } from '@/types/database';
import type { OrderAttachment, PaymentMethod, PendingClarification } from '@/types/domain';
import {
  getClarificationMediaUrlAction,
  getMessageMediaUrlAction,
  getMessagesAction,
  manualSendAction,
  resolveClarificationAction,
  takeOverAction,
} from '@/app/admin/chat/actions';
import { ClarificationPanel } from './clarification-panel';
import { OrderSummaryDialog } from './order-summary-dialog';

function parsePendingClarification(raw: unknown): PendingClarification | null {
  if (!raw || typeof raw !== 'object') return null;
  return raw as unknown as PendingClarification;
}

export type SessionRow = Database['public']['Tables']['chat_sessions']['Row'];
export type MessageRow = Database['public']['Tables']['chat_messages']['Row'];
export type TenantRow = Pick<
  Database['public']['Tables']['tenants']['Row'],
  'id' | 'business_name' | 'system_prompt' | 'catalog_data' | 'payments_enabled' | 'payment_methods'
>;

export interface SessionWithTenant extends SessionRow {
  tenantName: string;
}

export const PLATFORM_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  facebook: 'Facebook',
  web: 'Web',
  voice: 'Voice',
};

export const PLATFORM_DOT_COLORS: Record<string, string> = {
  whatsapp: 'bg-green-500',
  instagram: 'bg-pink-500',
  facebook: 'bg-blue-500',
  web: 'bg-sky-500',
  voice: 'bg-amber-500',
};

export function platformLabel(platform: string) {
  return PLATFORM_LABELS[platform] ?? platform;
}

export function platformDotColor(platform: string) {
  return PLATFORM_DOT_COLORS[platform] ?? 'bg-muted-foreground';
}

/** Human labels for the persisted alert_signal column (docs/08 GUARDRAIL_RULES) — real, LLM-detected signals. */
export const ALERT_SIGNAL_LABELS: Record<string, string> = {
  frustrated: 'Customer sounds frustrated or upset',
  price_objection: 'Price objection — pushed back on cost',
  product_doubt: 'Doubts about product/quality',
  cancellation_risk: 'Risk of cancellation',
};

export function alertSignalLabel(signal: string) {
  return ALERT_SIGNAL_LABELS[signal] ?? signal;
}

/** Compact relative-time label for list rows ("now", "5m", "3h", "2d"). */
export function relativeTime(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return `${Math.floor(diffHr / 24)}d`;
}

/** Small identity anchor for a session row — initial-based, with a corner dot when a human has taken over. */
export function SessionAvatar({ name, alert }: { name: string; alert?: boolean }) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <div className="relative shrink-0">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted-foreground/15 text-xs font-semibold text-muted-foreground">
        {initial}
      </div>
      {alert && (
        <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-destructive" />
      )}
    </div>
  );
}

export function ConversationPane({
  session,
  tenant,
  supabase,
  onTakeOverChange,
  viewer = 'admin',
}: {
  session: SessionWithTenant;
  tenant: TenantRow | undefined;
  supabase: SupabaseClient<Database>;
  onTakeOverChange: (sessionId: string, next: boolean) => void;
  /** Clients get a plain-language summary — the raw system prompt/catalogue JSON is internal (docs/13 §9). */
  viewer?: 'admin' | 'client';
}) {
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [isPending, startTransition] = useTransition();
  const [showDetails, setShowDetails] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setMessagesLoading(true);
    getMessagesAction(session.id)
      .then((data) => {
        if (active) setMessages(data);
      })
      .catch((err) => {
        console.error('Failed to load message history', err);
        if (active) toast.error('Failed to load message history.');
      })
      .finally(() => {
        if (active) setMessagesLoading(false);
      });

    const channel = supabase
      .channel(`chat-messages-${session.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `session_id=eq.${session.id}` },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as MessageRow]);
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chat_messages', filter: `session_id=eq.${session.id}` },
        (payload) => {
          const updated = payload.new as MessageRow;
          setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [session.id, supabase]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  function handleTakeOver(next: boolean) {
    startTransition(async () => {
      try {
        await takeOverAction(session.id, next);
        onTakeOverChange(session.id, next);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update handoff.');
      }
    });
  }

  function handleSend() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    const needsTakeOver = !session.is_human_handoff;
    startTransition(async () => {
      try {
        await Promise.all([
          manualSendAction(session.id, text),
          needsTakeOver ? takeOverAction(session.id, true) : Promise.resolve(),
        ]);
        if (needsTakeOver) onTakeOverChange(session.id, true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to send message.');
      }
    });
  }

  async function handleResolveClarification(note: string) {
    try {
      await resolveClarificationAction(session.id, note);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to resolve.');
    }
  }

  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4">
          <div className="flex min-w-0 items-center gap-3">
            <SessionAvatar name={session.tenantName} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-none">{session.tenantName}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {session.external_user_id} · <span className="capitalize">{session.platform}</span>
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <OrderSummaryDialog
              sessionId={session.id}
              paymentMethods={tenant?.payments_enabled ? ((tenant.payment_methods as PaymentMethod[] | null) ?? []) : []}
            />
            <div className="flex items-center gap-2" title={session.is_human_handoff ? 'The AI has stopped replying — you’re answering this chat yourself' : 'The AI is currently replying to this customer'}>
              <span className="text-xs font-medium text-muted-foreground">Human takeover</span>
              <Switch checked={session.is_human_handoff} onCheckedChange={handleTakeOver} disabled={isPending} />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setShowDetails((v) => !v)}
              aria-label={showDetails ? 'Hide details' : 'Show details'}
            >
              {showDetails ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-2 px-4 py-3">
            {messages.map((m) => {
              if (m.role === 'system') {
                return (
                  <div key={m.id} className="flex justify-center">
                    <span className="max-w-[85%] rounded-full bg-muted-foreground/10 px-3 py-1 text-center text-xs text-muted-foreground">
                      {m.content}
                    </span>
                  </div>
                );
              }
              const attachments = (m.attachments as unknown as OrderAttachment[] | null) ?? [];
              return (
                <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                  <div
                    className={`max-w-[75%] px-3.5 py-2 text-sm shadow-sm ${
                      m.role === 'user'
                        ? 'rounded-2xl rounded-bl-md bg-muted'
                        : 'rounded-2xl rounded-br-md bg-primary text-primary-foreground'
                    }`}
                  >
                    {attachments.length > 0 && (
                      <div className="mb-2 flex flex-col gap-2">
                        {attachments.map((a) => (
                          <MessageAttachmentPreview key={a.storagePath} messageId={m.id} attachment={a} />
                        ))}
                      </div>
                    )}
                    {m.content}
                    {m.delivery_failed && (
                      <p className="mt-1 text-xs font-medium text-destructive">Not delivered — customer may not have received this.</p>
                    )}
                  </div>
                </div>
              );
            })}
            {messages.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {messagesLoading ? 'Loading messages…' : 'No messages yet.'}
              </p>
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
        <div className="shrink-0 border-t bg-background p-3">
          {!session.is_human_handoff && (
            <p className="mb-1.5 text-xs text-muted-foreground">
              Sending a message here switches this chat to human takeover, so the bot stops replying.
            </p>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type a reply…"
              rows={1}
              className="resize-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <Button onClick={handleSend} disabled={isPending || !draft.trim()}>
              Send
            </Button>
          </div>
        </div>
      </div>

      {showDetails && (
        <div className="flex min-h-0 w-72 shrink-0 flex-col border-l bg-muted/20">
          <div className="flex h-14 shrink-0 items-center border-b px-4">
            <h3 className="text-sm font-semibold leading-none">Details</h3>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-5 p-4">
              <ClarificationPanel
                pendingClarification={parsePendingClarification(session.pending_clarification)}
                onResolve={handleResolveClarification}
                getAttachmentUrl={(path) => getClarificationMediaUrlAction(session.id, path)}
              />
              <div>
                <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Conversation
                </p>
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Platform</dt>
                    <dd>{platformLabel(session.platform)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Started</dt>
                    <dd>{new Date(session.created_at).toLocaleString()}</dd>
                  </div>
                  {session.alert_signal && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Alert</dt>
                      <dd className="text-right text-destructive">{alertSignalLabel(session.alert_signal)}</dd>
                    </div>
                  )}
                </dl>
              </div>
              {viewer === 'admin' ? (
                <>
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                      System prompt
                    </p>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{tenant?.system_prompt || '—'}</p>
                  </div>
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                      Catalogue
                    </p>
                    <pre className="max-h-64 overflow-auto rounded-lg border bg-background p-2.5 text-xs">
                      {JSON.stringify(tenant?.catalog_data ?? {}, null, 2)}
                    </pre>
                  </div>
                </>
              ) : (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    AI assistant
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Answers are grounded in your business details and catalogue.{' '}
                    <a href="/dashboard/business" className="underline underline-offset-2">
                      Edit them here
                    </a>
                    .
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      )}
    </>
  );
}

/** Fetches a short-TTL signed URL for one message attachment and renders it by kind (docs/10 §4/§5/§6.1). */
function MessageAttachmentPreview({ messageId, attachment }: { messageId: string; attachment: OrderAttachment }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    getMessageMediaUrlAction(messageId, attachment.storagePath)
      .then((signedUrl) => {
        if (active) {
          if (signedUrl) setUrl(signedUrl);
          else setFailed(true);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [messageId, attachment.storagePath]);

  if (failed) return <p className="text-xs italic text-muted-foreground">Media unavailable.</p>;
  if (!url) return <p className="text-xs text-muted-foreground">Loading media…</p>;

  if (attachment.kind === 'image') {
    // eslint-disable-next-line @next/next/no-img-element -- signed URL, not an optimizable static asset
    return <img src={url} alt="Customer attachment" className="max-h-48 rounded-lg object-contain" />;
  }
  if (attachment.kind === 'audio') {
    return <audio controls src={url} className="h-8 max-w-full" />;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="text-xs underline underline-offset-2">
      View video
    </a>
  );
}
