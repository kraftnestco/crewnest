'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Check, ChevronDown } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  getUnreadCountAction,
  listNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '@/lib/notifications/actions';
import type { Database } from '@/types/database';
import type { Notification } from '@/types/domain';

const ALL_CLIENTS = '__all__';

type NotificationRow = Database['public']['Tables']['notifications']['Row'];

function mapRow(row: NotificationRow): Notification {
  return {
    id: row.id,
    scope: row.scope as Notification['scope'],
    tenantId: row.tenant_id,
    type: row.type as Notification['type'],
    title: row.title,
    body: row.body,
    entityType: row.entity_type as Notification['entityType'],
    entityId: row.entity_id,
    link: row.link,
    isRead: row.is_read,
    createdAt: row.created_at,
  };
}

/** Compact relative-time label ("now", "5m", "3h", "2d") — mirrors inbox/conversation-pane.tsx's helper. */
function relativeTime(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return `${Math.floor(diffHr / 24)}d`;
}

export function NotificationBell({
  initialNotifications,
  initialUnreadCount,
  realtimeAccessToken,
  clients = [],
  scopeKind = 'agency',
}: {
  initialNotifications: Notification[];
  initialUnreadCount: number;
  realtimeAccessToken: string | null;
  /**
   * Scope-filter options — one per client for the agency, or the caller's own
   * businesses when they belong to more than one. Empty (so the dropdown is
   * absent) for a single-business member, whose feed is one business already.
   */
  clients?: { tenantId: string; businessName: string }[];
  /** 'agency' phrases the filter as clients; 'client' as businesses. */
  scopeKind?: 'agency' | 'client';
}) {
  const router = useRouter();
  // The agency filters across its CLIENTS; a multi-business owner filters across
  // their own BUSINESSES. Same control, different noun.
  const allLabel = scopeKind === 'agency' ? 'All clients' : 'All businesses';
  // The unfiltered "all clients" list — the one realtime inserts and mark-read
  // actually mutate, always. Kept separate from `filteredNotifications` below so
  // a live insert or a read-toggle never has to know which view is on screen.
  const [notifications, setNotifications] = useState(initialNotifications);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [isPending, startTransition] = useTransition();
  const [selectedTenantId, setSelectedTenantId] = useState<string>(ALL_CLIENTS);
  // Only populated while a single client is selected — a SEPARATE fetch result,
  // not a derived slice of `notifications` (that list is capped at the last 20
  // across ALL clients, so a client's own item may not even be in it).
  const [filteredNotifications, setFilteredNotifications] = useState<Notification[] | null>(null);
  const [isFilterLoading, setIsFilterLoading] = useState(false);
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const visibleNotifications = selectedTenantId === ALL_CLIENTS ? notifications : (filteredNotifications ?? []);

  useEffect(() => {
    if (selectedTenantId === ALL_CLIENTS) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicking off the loading flag is a reaction to the dropdown selection, not a render-time state sync
    setIsFilterLoading(true);
    listNotificationsAction(20, selectedTenantId)
      .then((rows) => {
        if (!cancelled) setFilteredNotifications(rows);
      })
      .finally(() => {
        if (!cancelled) setIsFilterLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTenantId]);

  // Same trust boundary as the Live Inbox (inbox.tsx): the auth cookie is HttpOnly,
  // so this client has no session of its own — hand Realtime the access token
  // fetched server-side so postgres_changes RLS authorizes it.
  useEffect(() => {
    if (realtimeAccessToken) void supabase.realtime.setAuth(realtimeAccessToken);
  }, [realtimeAccessToken, supabase]);

  // The subscription is set up once (mount), so it reads the current filter via
  // a ref rather than closing over `selectedTenantId` directly — otherwise every
  // filter change would need to re-subscribe the channel.
  const selectedTenantIdRef = useRef(selectedTenantId);
  useEffect(() => {
    selectedTenantIdRef.current = selectedTenantId;
  }, [selectedTenantId]);

  useEffect(() => {
    const channel = supabase
      .channel('notification-bell')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
        const row = mapRow(payload.new as NotificationRow);
        // Badge always counts everything (confirmed intentional, see above).
        setUnreadCount((prev) => prev + 1);
        // The "all clients" list always gets it (it's what the badge count is
        // conceptually backing); the filtered list only if it matches — so a
        // filtered admin doesn't see another client's item appear live.
        setNotifications((prev) => [row, ...prev].slice(0, 20));
        if (selectedTenantIdRef.current === row.tenantId) {
          setFilteredNotifications((prev) => [row, ...(prev ?? [])].slice(0, 20));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  function handleOpen(notification: Notification) {
    if (!notification.isRead) {
      const markRead = (n: Notification) => (n.id === notification.id ? { ...n, isRead: true } : n);
      setNotifications((prev) => prev.map(markRead));
      setFilteredNotifications((prev) => (prev ? prev.map(markRead) : prev));
      setUnreadCount((prev) => Math.max(0, prev - 1));
      startTransition(() => {
        void markNotificationReadAction(notification.id);
      });
    }
    router.push(notification.link);
  }

  function handleMarkAllRead() {
    // The visible lists are capped at 20 rows and can miss unread notifications
    // that exist server-side but never made it into that page — subtracting a
    // client-side count from `unreadCount` was exactly this bug (badge stuck at
    // a stale number after "mark all read"). The badge is refetched from the
    // server after the mutation resolves instead of estimated.
    const markAllRead = (n: Notification) => ({ ...n, isRead: true });
    if (selectedTenantId === ALL_CLIENTS) {
      setNotifications((prev) => prev.map(markAllRead));
    } else {
      setFilteredNotifications((prev) => (prev ? prev.map(markAllRead) : prev));
      // The "all clients" list may also hold some of this client's rows
      // (it's a superset within its own 20-row cap) — keep it consistent too.
      setNotifications((prev) => prev.map((n) => (n.tenantId === selectedTenantId ? { ...n, isRead: true } : n)));
    }
    const filter = selectedTenantId === ALL_CLIENTS ? null : selectedTenantId;
    startTransition(() => {
      void markAllNotificationsReadAction(filter).then(() => getUnreadCountAction()).then(setUnreadCount);
    });
  }

  return (
    <Popover>
      <PopoverTrigger
        className="relative flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <Badge
            variant="destructive"
            className="absolute -top-0.5 -right-0.5 h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </Badge>
        )}
      </PopoverTrigger>
      {/* Height model, in one place because it's easy to break:
          - `max-h-96` bounds the whole popup so it can never run off-screen.
          - header + filter are `shrink-0`; the list below is `flex-1` and takes
            whatever is left.
          - `min-h-0` on that list is load-bearing — a flex child defaults to
            min-height:auto and refuses to shrink below its content, so without
            it the list grows instead of scrolling.
          Plain `overflow-y-auto` rather than <ScrollArea>: that component sets
          its own height/overflow internally, which fought this flex chain. */}
      {/* `max-w-[calc(100vw-1rem)]` keeps the panel on-screen on a narrow
          phone, where a flat 320px popup anchored to the right edge of a
          ~375px viewport would otherwise run past the left edge. */}
      <PopoverContent align="end" className="flex max-h-96 w-80 max-w-[calc(100vw-1rem)] flex-col gap-0 p-0">
        <div className="flex shrink-0 items-center justify-between border-b p-2.5">
          <p className="text-sm font-semibold">Notifications</p>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              disabled={isPending}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Check className="h-3 w-3" />
              Mark all read
            </button>
          )}
        </div>
        {/* Scope filter. Agency: one entry per client with notifications. Client
            with several businesses: their own businesses, matching the control
            the Orders page already offers. Absent for a single-business member,
            whose feed is one business by definition — `clients` is empty then. */}
        {clients.length > 0 && (
          <div className="shrink-0 border-b p-2">
            <DropdownMenu>
              <DropdownMenuTrigger className="flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/60">
                <span className="truncate">
                  {selectedTenantId === ALL_CLIENTS
                    ? allLabel
                    : (clients.find((c) => c.tenantId === selectedTenantId)?.businessName ?? allLabel)}
                </span>
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-h-72 w-(--anchor-width) min-w-56">
                <DropdownMenuRadioGroup value={selectedTenantId} onValueChange={setSelectedTenantId}>
                  <DropdownMenuRadioItem value={ALL_CLIENTS}>{allLabel}</DropdownMenuRadioItem>
                  {clients.map((c) => (
                    <DropdownMenuRadioItem key={c.tenantId} value={c.tenantId}>
                      {c.businessName}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isFilterLoading ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : visibleNotifications.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {selectedTenantId === ALL_CLIENTS ? "You're all caught up." : 'No notifications for this client.'}
            </p>
          ) : (
            <div className="flex flex-col p-1.5">
              {visibleNotifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleOpen(n)}
                  className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted/60"
                >
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${n.isRead ? 'bg-transparent' : 'bg-primary'}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium">{n.title}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{relativeTime(n.createdAt)}</span>
                    </div>
                    {n.body && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{n.body}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
