'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, TriangleAlert } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  alertSignalLabel,
  ConversationPane,
  platformDotColor,
  platformLabel,
  relativeTime,
  type SessionRow,
  type SessionWithTenant,
  type TenantRow,
} from '@/app/_shared/inbox/conversation-pane';

/**
 * The active tenant's own scoped Live Inbox. Deliberately flat — no "Clients"
 * drill-down, no cross-tenant list — this is what makes it safe to show a
 * client. See docs/13-CLIENT-DASHBOARD-TENANT-ACCESS.md §8.
 */
export function DashboardInbox({
  tenantId,
  initialSessions,
  tenant,
  realtimeAccessToken,
  initialSelectedId,
}: {
  tenantId: string;
  initialSessions: SessionWithTenant[];
  tenant: TenantRow;
  realtimeAccessToken: string | null;
  initialSelectedId?: string | null;
}) {
  const [sessions, setSessions] = useState(initialSessions);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? initialSessions[0]?.id ?? null);
  const [platformFilter, setPlatformFilter] = useState('all');
  const [query, setQuery] = useState('');
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const selected = sessions.find((s) => s.id === selectedId) ?? null;

  const platforms = useMemo(() => [...new Set(sessions.map((s) => s.platform))], [sessions]);

  const trimmedQuery = query.trim().toLowerCase();
  const visibleSessions = useMemo(
    () =>
      sessions.filter((s) => {
        if (platformFilter !== 'all' && s.platform !== platformFilter) return false;
        if (trimmedQuery && !s.external_user_id.toLowerCase().includes(trimmedQuery)) return false;
        return true;
      }),
    [sessions, platformFilter, trimmedQuery],
  );

  // Auth cookies are HttpOnly, so this client has no session of its own — hand
  // Realtime the access token fetched server-side so postgres_changes RLS
  // authorizes it (same pattern as the agency inbox).
  useEffect(() => {
    if (realtimeAccessToken) void supabase.realtime.setAuth(realtimeAccessToken);
  }, [realtimeAccessToken, supabase]);

  useEffect(() => {
    const channel = supabase
      .channel('dashboard-chat-sessions')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_sessions', filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          setSessions((prev) => {
            if (payload.eventType === 'DELETE') {
              const deletedId = (payload.old as Partial<SessionRow>).id;
              return prev.filter((s) => s.id !== deletedId);
            }
            const row = payload.new as SessionRow;
            const withTenant: SessionWithTenant = { ...row, tenantName: tenant.business_name };
            const exists = prev.some((s) => s.id === row.id);
            const next = exists ? prev.map((s) => (s.id === row.id ? withTenant : s)) : [withTenant, ...prev];
            return [...next].sort(
              (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime(),
            );
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, tenantId, tenant.business_name]);

  function handleSelectSession(id: string) {
    setSelectedId(id);
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, unread_count: 0, alert_signal: null } : s)));
  }

  function handleTakeOverChange(sessionId: string, next: boolean) {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, is_human_handoff: next } : s)));
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 w-80 shrink-0 flex-col border-r bg-muted/20">
        <div className="flex h-14 shrink-0 items-center border-b px-4">
          <div>
            <h2 className="font-heading text-sm font-semibold leading-none">My Inbox</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {sessions.length} conversation{sessions.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        <div className="shrink-0 border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search customers…"
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>

        {platforms.length > 1 && (
          <div className="flex flex-wrap gap-1.5 border-b px-2.5 py-2">
            <button
              type="button"
              onClick={() => setPlatformFilter('all')}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                platformFilter === 'all'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted-foreground/15'
              }`}
            >
              All
            </button>
            {platforms.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPlatformFilter(p)}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  platformFilter === p
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted-foreground/15'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${platformFilter === p ? 'bg-primary-foreground' : platformDotColor(p)}`}
                />
                {platformLabel(p)}
              </button>
            ))}
          </div>
        )}

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-1 p-1.5">
            {visibleSessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => handleSelectSession(s.id)}
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
                        <TriangleAlert className="h-3 w-3 text-amber-500" aria-label={alertSignalLabel(s.alert_signal)}>
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
            {visibleSessions.length === 0 && (
              <p className="p-4 text-center text-sm text-muted-foreground">
                {sessions.length === 0
                  ? 'No conversations yet — once a customer messages your business, it will show up here.'
                  : 'No conversations match your search.'}
              </p>
            )}
          </div>
        </ScrollArea>
      </div>

      {selected ? (
        <ConversationPane
          key={selected.id}
          session={selected}
          tenant={tenant}
          supabase={supabase}
          onTakeOverChange={handleTakeOverChange}
          viewer="client"
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
