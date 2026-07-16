'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ChevronLeft, ChevronRight, PanelRightClose, PanelRightOpen, Search, TriangleAlert } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { Database } from '@/types/database';
import type { OrderAttachment } from '@/types/domain';
import { getMessageMediaUrlAction, getMessagesAction, manualSendAction, takeOverAction } from './actions';

type SessionRow = Database['public']['Tables']['chat_sessions']['Row'];
type MessageRow = Database['public']['Tables']['chat_messages']['Row'];
type TenantRow = Pick<
  Database['public']['Tables']['tenants']['Row'],
  'id' | 'business_name' | 'system_prompt' | 'catalog_data'
>;

interface SessionWithTenant extends SessionRow {
  tenantName: string;
}

interface TenantGroup {
  tenantId: string;
  tenantName: string;
  sessions: SessionWithTenant[];
  platforms: string[];
  unreadTotal: number;
  hasAlert: boolean;
}

const PLATFORM_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  facebook: 'Facebook',
  web: 'Web',
  voice: 'Voice',
};

const PLATFORM_DOT_COLORS: Record<string, string> = {
  whatsapp: 'bg-green-500',
  instagram: 'bg-pink-500',
  facebook: 'bg-blue-500',
  web: 'bg-sky-500',
  voice: 'bg-amber-500',
};

function platformLabel(platform: string) {
  return PLATFORM_LABELS[platform] ?? platform;
}

function platformDotColor(platform: string) {
  return PLATFORM_DOT_COLORS[platform] ?? 'bg-muted-foreground';
}

/** Human labels for the persisted alert_signal column (docs/08 GUARDRAIL_RULES) — real, LLM-detected signals. */
const ALERT_SIGNAL_LABELS: Record<string, string> = {
  frustrated: 'Customer sounds frustrated or upset',
  price_objection: 'Price objection — pushed back on cost',
  product_doubt: 'Doubts about product/quality',
  cancellation_risk: 'Risk of cancellation',
};

function alertSignalLabel(signal: string) {
  return ALERT_SIGNAL_LABELS[signal] ?? signal;
}

/** Compact relative-time label for list rows ("now", "5m", "3h", "2d"). */
function relativeTime(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return `${Math.floor(diffHr / 24)}d`;
}

export function Inbox({
  initialSessions,
  tenants,
  realtimeAccessToken,
  initialSelectedId,
}: {
  initialSessions: SessionWithTenant[];
  tenants: TenantRow[];
  realtimeAccessToken: string | null;
  initialSelectedId?: string | null;
}) {
  const [sessions, setSessions] = useState(initialSessions);
  const initialSelected = initialSelectedId
    ? (initialSessions.find((s) => s.id === initialSelectedId) ?? null)
    : (initialSessions[0] ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelected?.id ?? null);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(
    initialSelected ? initialSelected.tenant_id : null,
  );
  const [platformFilter, setPlatformFilter] = useState<Record<string, string>>(() =>
    initialSelected ? { [initialSelected.tenant_id]: initialSelected.platform } : {},
  );
  const [query, setQuery] = useState('');
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const tenantMap = useMemo(() => new Map(tenants.map((t) => [t.id, t])), [tenants]);
  const selected = sessions.find((s) => s.id === selectedId) ?? null;
  const selectedTenant = selected ? tenantMap.get(selected.tenant_id) : undefined;

  const trimmedQuery = query.trim().toLowerCase();
  const filteredSessions = useMemo(() => {
    if (!trimmedQuery) return sessions;
    return sessions.filter(
      (s) =>
        s.tenantName.toLowerCase().includes(trimmedQuery) ||
        s.external_user_id.toLowerCase().includes(trimmedQuery),
    );
  }, [sessions, trimmedQuery]);

  // `sessions` (and therefore `filteredSessions`) is kept globally sorted by
  // last_message_at desc, so first-appearance order here already yields groups
  // sorted by their most recent activity — no secondary sort needed.
  const tenantGroups = useMemo<TenantGroup[]>(() => {
    const groups = new Map<string, TenantGroup>();
    for (const s of filteredSessions) {
      let group = groups.get(s.tenant_id);
      if (!group) {
        group = { tenantId: s.tenant_id, tenantName: s.tenantName, sessions: [], platforms: [], unreadTotal: 0, hasAlert: false };
        groups.set(s.tenant_id, group);
      }
      group.sessions.push(s);
      if (!group.platforms.includes(s.platform)) group.platforms.push(s.platform);
      group.unreadTotal += s.unread_count;
      if (s.is_human_handoff || s.alert_signal) group.hasAlert = true;
    }
    return [...groups.values()];
  }, [filteredSessions]);

  const recentSessions = useMemo(() => sessions.slice(0, 3), [sessions]);
  const allTenantCount = useMemo(() => new Set(sessions.map((s) => s.tenant_id)).size, [sessions]);

  const activeGroup =
    !trimmedQuery && activeTenantId ? tenantGroups.find((g) => g.tenantId === activeTenantId) : undefined;

  function openTenant(tenantId: string) {
    setActiveTenantId(tenantId);
  }

  function closeTenant() {
    setActiveTenantId(null);
  }

  function getPlatformFilter(tenantId: string) {
    return platformFilter[tenantId] ?? 'all';
  }

  function setTenantPlatform(tenantId: string, platform: string) {
    setPlatformFilter((prev) => ({ ...prev, [tenantId]: platform }));
  }

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

  // Opening a chat acknowledges its alert — local-only, same as the unread_count
  // reset below; the real alert_signal column is only ever SET server-side
  // (aiOrchestrator), so a fresh alert on a re-fetch/realtime update still shows.
  function handleSelectSession(id: string) {
    setSelectedId(id);
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, unread_count: 0, alert_signal: null } : s)));
  }

  /** Selecting from Recent or search should drill straight into that client's full view and platform tab. */
  function openSession(session: SessionWithTenant) {
    handleSelectSession(session.id);
    setActiveTenantId(session.tenant_id);
    setPlatformFilter((prev) => ({ ...prev, [session.tenant_id]: session.platform }));
  }

  function handleTakeOverChange(sessionId: string, next: boolean) {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, is_human_handoff: next } : s)));
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 w-80 shrink-0 flex-col border-r bg-muted/20">
        <div className="flex h-14 shrink-0 items-center border-b px-4">
          <div>
            <h2 className="font-heading text-sm font-semibold leading-none">Live Inbox</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {allTenantCount} client{allTenantCount === 1 ? '' : 's'} · {sessions.length} conversation
              {sessions.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        <div className="shrink-0 border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search clients or customers…"
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col p-1.5">
            {trimmedQuery ? (
              <div className="flex flex-col gap-3">
                {tenantGroups.map((group) => (
                  <div key={group.tenantId} className="flex flex-col gap-1">
                    <p className="px-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground/70 uppercase">
                      {group.tenantName}
                    </p>
                    <div className="flex flex-col gap-1">
                      {group.sessions.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => openSession(s)}
                          className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                            s.id === selectedId ? 'bg-background shadow-sm ring-1 ring-border' : 'hover:bg-background/60'
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${platformDotColor(s.platform)}`} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-xs font-medium">{s.external_user_id}</span>
                              <div className="flex shrink-0 items-center gap-1">
                                {s.alert_signal && (
                                  <TriangleAlert
                                    className="h-3 w-3 text-amber-500"
                                    aria-label={alertSignalLabel(s.alert_signal)}
                                  >
                                    <title>{alertSignalLabel(s.alert_signal)}</title>
                                  </TriangleAlert>
                                )}
                                {s.is_human_handoff && <span className="h-1.5 w-1.5 rounded-full bg-destructive" />}
                                {s.unread_count > 0 && (
                                  <Badge
                                    variant="destructive"
                                    className="h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none"
                                  >
                                    {s.unread_count}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <span className="text-[10px] text-muted-foreground">
                              {platformLabel(s.platform)} · {relativeTime(s.last_message_at)}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {tenantGroups.length === 0 && (
                  <p className="p-4 text-center text-sm text-muted-foreground">No conversations found.</p>
                )}
              </div>
            ) : activeTenantId && activeGroup ? (
              (() => {
                const activePlatform = getPlatformFilter(activeGroup.tenantId);
                const visibleSessions =
                  activePlatform === 'all'
                    ? activeGroup.sessions
                    : activeGroup.sessions.filter((s) => s.platform === activePlatform);
                return (
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={closeTenant}
                      className="flex items-center gap-1 self-start rounded-lg px-1.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      All clients
                    </button>

                    <div className="flex items-center gap-2.5 px-1.5 py-1">
                      <SessionAvatar name={activeGroup.tenantName} alert={activeGroup.hasAlert} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{activeGroup.tenantName}</p>
                        <p className="text-xs text-muted-foreground">
                          {activeGroup.sessions.length} conversation{activeGroup.sessions.length === 1 ? '' : 's'}
                        </p>
                      </div>
                    </div>

                    {activeGroup.platforms.length > 1 && (
                      <div className="flex flex-wrap gap-1.5 px-1.5 pb-1">
                        <button
                          type="button"
                          onClick={() => setTenantPlatform(activeGroup.tenantId, 'all')}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            activePlatform === 'all'
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-muted-foreground hover:bg-muted-foreground/15'
                          }`}
                        >
                          All
                        </button>
                        {activeGroup.platforms.map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setTenantPlatform(activeGroup.tenantId, p)}
                            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                              activePlatform === p
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted text-muted-foreground hover:bg-muted-foreground/15'
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${activePlatform === p ? 'bg-primary-foreground' : platformDotColor(p)}`}
                            />
                            {platformLabel(p)}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-col gap-1">
                      {visibleSessions.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => openSession(s)}
                          className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors ${
                            s.id === selectedId ? 'bg-background shadow-sm ring-1 ring-border' : 'hover:bg-background/60'
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${platformDotColor(s.platform)}`} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-xs font-medium">{s.external_user_id}</span>
                              <div className="flex shrink-0 items-center gap-1.5">
                                {s.alert_signal && (
                                  <TriangleAlert
                                    className="h-3 w-3 text-amber-500"
                                    aria-label={alertSignalLabel(s.alert_signal)}
                                  >
                                    <title>{alertSignalLabel(s.alert_signal)}</title>
                                  </TriangleAlert>
                                )}
                                {s.is_human_handoff && <span className="h-1.5 w-1.5 rounded-full bg-destructive" />}
                                {s.unread_count > 0 && (
                                  <Badge
                                    variant="destructive"
                                    className="h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none"
                                  >
                                    {s.unread_count}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <span className="text-[10px] text-muted-foreground">{relativeTime(s.last_message_at)}</span>
                          </div>
                        </button>
                      ))}
                      {visibleSessions.length === 0 && (
                        <p className="p-4 text-center text-sm text-muted-foreground">No conversations on this platform.</p>
                      )}
                    </div>
                  </div>
                );
              })()
            ) : (
              <>
                {recentSessions.length > 0 && (
                  <div className="mb-1.5">
                    <p className="px-1.5 pb-1 text-[10px] font-semibold tracking-wide text-muted-foreground/70 uppercase">
                      Recent
                    </p>
                    <div className="flex flex-col gap-0.5">
                      {recentSessions.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => openSession(s)}
                          className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                            s.id === selectedId ? 'bg-background shadow-sm ring-1 ring-border' : 'hover:bg-background/60'
                          }`}
                        >
                          <SessionAvatar name={s.tenantName} alert={s.is_human_handoff || Boolean(s.alert_signal)} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-xs font-medium">{s.tenantName}</span>
                              <span className="shrink-0 text-[10px] text-muted-foreground">
                                {relativeTime(s.last_message_at)}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${platformDotColor(s.platform)}`} />
                              <span className="truncate text-[10px] text-muted-foreground">
                                {platformLabel(s.platform)} · {s.external_user_id}
                              </span>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <p className="px-1.5 pb-1 text-[10px] font-semibold tracking-wide text-muted-foreground/70 uppercase">
                  Clients
                </p>
                <div className="flex flex-col gap-1">
                  {tenantGroups.map((group) => (
                    <button
                      key={group.tenantId}
                      type="button"
                      onClick={() => openTenant(group.tenantId)}
                      className="flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-background/60"
                    >
                      <SessionAvatar name={group.tenantName} alert={group.hasAlert} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{group.tenantName}</span>
                          {group.unreadTotal > 0 && (
                            <Badge
                              variant="destructive"
                              className="h-4 min-w-4 shrink-0 justify-center rounded-full px-1 text-[10px] leading-none"
                            >
                              {group.unreadTotal}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {group.sessions.length} conversation{group.sessions.length === 1 ? '' : 's'}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                    </button>
                  ))}
                  {tenantGroups.length === 0 && (
                    <p className="p-4 text-center text-sm text-muted-foreground">No conversations found.</p>
                  )}
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </div>

      {selected ? (
        <ConversationPane
          key={selected.id}
          session={selected}
          tenant={selectedTenant}
          supabase={supabase}
          onTakeOverChange={handleTakeOverChange}
        />
      ) : (
        <>
          <div className="flex min-w-0 flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a conversation
          </div>
          <div className="flex w-72 shrink-0 flex-col border-l bg-muted/20">
            <div className="flex h-14 shrink-0 items-center border-b px-4">
              <h3 className="text-sm font-semibold leading-none">Details</h3>
            </div>
            <p className="p-4 text-sm text-muted-foreground">No conversation selected.</p>
          </div>
        </>
      )}
    </div>
  );
}

/** Small identity anchor for a session row — initial-based, with a corner dot when a human has taken over. */
function SessionAvatar({ name, alert }: { name: string; alert?: boolean }) {
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

function ConversationPane({
  session,
  tenant,
  supabase,
  onTakeOverChange,
}: {
  session: SessionWithTenant;
  tenant: TenantRow | undefined;
  supabase: SupabaseClient<Database>;
  onTakeOverChange: (sessionId: string, next: boolean) => void;
}) {
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [draft, setDraft] = useState('');
  const [isPending, startTransition] = useTransition();
  const [showDetails, setShowDetails] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    getMessagesAction(session.id)
      .then((data) => {
        if (active) setMessages(data);
      })
      .catch((err) => {
        console.error('Failed to load message history', err);
        if (active) toast.error('Failed to load message history.');
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
            <div className="flex items-center gap-2">
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
                  </div>
                </div>
              );
            })}
            {messages.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">No messages yet.</p>
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
