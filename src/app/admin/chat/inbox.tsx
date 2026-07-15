'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { Database } from '@/types/database';
import { manualSendAction, takeOverAction } from './actions';

type SessionRow = Database['public']['Tables']['chat_sessions']['Row'];
type MessageRow = Database['public']['Tables']['chat_messages']['Row'];
type TenantRow = Pick<
  Database['public']['Tables']['tenants']['Row'],
  'id' | 'business_name' | 'system_prompt' | 'catalog_data'
>;

interface SessionWithTenant extends SessionRow {
  tenantName: string;
}

export function Inbox({
  initialSessions,
  tenants,
  realtimeAccessToken,
}: {
  initialSessions: SessionWithTenant[];
  tenants: TenantRow[];
  realtimeAccessToken: string | null;
}) {
  const [sessions, setSessions] = useState(initialSessions);
  const [selectedId, setSelectedId] = useState<string | null>(initialSessions[0]?.id ?? null);
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const tenantMap = useMemo(() => new Map(tenants.map((t) => [t.id, t])), [tenants]);
  const selected = sessions.find((s) => s.id === selectedId) ?? null;
  const selectedTenant = selected ? tenantMap.get(selected.tenant_id) : undefined;

  // The session cookie is HttpOnly, so this client has no session of its own —
  // hand Realtime the access token fetched server-side so postgres_changes RLS
  // authorizes it. Propagates to channels (incl. ConversationPane's, same
  // singleton client) whether they're already joined or join afterwards.
  useEffect(() => {
    if (realtimeAccessToken) void supabase.realtime.setAuth(realtimeAccessToken);
  }, [realtimeAccessToken, supabase]);

  useEffect(() => {
    const channel = supabase
      .channel('admin-chat-sessions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_sessions' }, (payload) => {
        setSessions((prev) => {
          if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as Partial<SessionRow>).id;
            return prev.filter((s) => s.id !== deletedId);
          }
          const row = payload.new as SessionRow;
          const tenantName = tenantMap.get(row.tenant_id)?.business_name ?? 'Unknown';
          const withTenant: SessionWithTenant = { ...row, tenantName };
          const exists = prev.some((s) => s.id === row.id);
          const next = exists ? prev.map((s) => (s.id === row.id ? withTenant : s)) : [withTenant, ...prev];
          return [...next].sort(
            (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime(),
          );
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, tenantMap]);

  function handleSelectSession(id: string) {
    setSelectedId(id);
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, unread_count: 0 } : s)));
  }

  function handleTakeOverChange(sessionId: string, next: boolean) {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, is_human_handoff: next } : s)));
  }

  return (
    <div className="flex h-screen">
      <div className="flex w-72 shrink-0 flex-col border-r">
        <div className="border-b p-4">
          <h2 className="font-heading text-sm font-semibold">Live Inbox</h2>
          <p className="text-xs text-muted-foreground">
            {sessions.length} conversation{sessions.length === 1 ? '' : 's'}
          </p>
        </div>
        <ScrollArea className="flex-1">
          <div className="flex flex-col">
            {sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => handleSelectSession(s.id)}
                className={`border-b px-4 py-3 text-left transition-colors hover:bg-muted/50 ${
                  s.id === selectedId ? 'bg-muted' : ''
                } ${s.is_human_handoff ? 'border-l-2 border-l-destructive' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{s.tenantName}</span>
                  {s.unread_count > 0 && (
                    <Badge variant="destructive" className="shrink-0">
                      {s.unread_count}
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-muted-foreground">{s.external_user_id}</span>
                  <Badge variant="outline" className="shrink-0 capitalize">
                    {s.platform}
                  </Badge>
                </div>
              </button>
            ))}
            {sessions.length === 0 && <p className="p-4 text-sm text-muted-foreground">No conversations yet.</p>}
          </div>
        </ScrollArea>
      </div>

      {selected ? (
        <ConversationPane
          key={selected.id}
          session={selected}
          tenant={selectedTenant}
          onTakeOverChange={handleTakeOverChange}
        />
      ) : (
        <>
          <div className="flex min-w-0 flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a conversation
          </div>
          <div className="w-72 shrink-0 border-l p-4">
            <p className="text-sm text-muted-foreground">No conversation selected.</p>
          </div>
        </>
      )}
    </div>
  );
}

function ConversationPane({
  session,
  tenant,
  onTakeOverChange,
}: {
  session: SessionWithTenant;
  tenant: TenantRow | undefined;
  onTakeOverChange: (sessionId: string, next: boolean) => void;
}) {
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [draft, setDraft] = useState('');
  const [isPending, startTransition] = useTransition();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  useEffect(() => {
    let active = true;
    supabase
      .from('chat_messages')
      .select('*')
      .eq('session_id', session.id)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (active) setMessages(data ?? []);
      });

    const channel = supabase
      .channel(`admin-chat-messages-${session.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `session_id=eq.${session.id}` },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as MessageRow]);
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [session.id, supabase]);

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
    startTransition(async () => {
      try {
        await manualSendAction(session.id, text);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to send message.');
      }
    });
  }

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b p-4">
          <div>
            <p className="text-sm font-semibold">{session.tenantName}</p>
            <p className="text-xs text-muted-foreground">
              {session.external_user_id} · {session.platform}
            </p>
          </div>
          {session.is_human_handoff && <Badge variant="destructive">Human handoff</Badge>}
        </div>
        <ScrollArea className="flex-1 p-4">
          <div className="flex flex-col gap-3">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                    m.role === 'user' ? 'bg-muted' : 'bg-primary text-primary-foreground'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {messages.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">No messages yet.</p>
            )}
          </div>
        </ScrollArea>
        <div className="flex gap-2 border-t p-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type a reply…"
            rows={1}
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

      <div className="w-72 shrink-0 space-y-4 overflow-y-auto border-l p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Human takeover</span>
          <Switch checked={session.is_human_handoff} onCheckedChange={handleTakeOver} disabled={isPending} />
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">System prompt</p>
          <p className="text-sm whitespace-pre-wrap">{tenant?.system_prompt || '—'}</p>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Catalogue</p>
          <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-2 text-xs">
            {JSON.stringify(tenant?.catalog_data ?? {}, null, 2)}
          </pre>
        </div>
      </div>
    </>
  );
}
