'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Check } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { markAllNotificationsReadAction, markNotificationReadAction } from '@/lib/notifications/actions';
import type { Database } from '@/types/database';
import type { Notification } from '@/types/domain';

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
}: {
  initialNotifications: Notification[];
  initialUnreadCount: number;
  realtimeAccessToken: string | null;
}) {
  const router = useRouter();
  const [notifications, setNotifications] = useState(initialNotifications);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [isPending, startTransition] = useTransition();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  // Same trust boundary as the Live Inbox (inbox.tsx): the auth cookie is HttpOnly,
  // so this client has no session of its own — hand Realtime the access token
  // fetched server-side so postgres_changes RLS authorizes it.
  useEffect(() => {
    if (realtimeAccessToken) void supabase.realtime.setAuth(realtimeAccessToken);
  }, [realtimeAccessToken, supabase]);

  useEffect(() => {
    const channel = supabase
      .channel('notification-bell')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
        const row = mapRow(payload.new as NotificationRow);
        setNotifications((prev) => [row, ...prev].slice(0, 20));
        setUnreadCount((prev) => prev + 1);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  function handleOpen(notification: Notification) {
    if (!notification.isRead) {
      setNotifications((prev) => prev.map((n) => (n.id === notification.id ? { ...n, isRead: true } : n)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
      startTransition(() => {
        void markNotificationReadAction(notification.id);
      });
    }
    router.push(notification.link);
  }

  function handleMarkAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    startTransition(() => {
      void markAllNotificationsReadAction();
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
      <PopoverContent align="end" className="w-80 gap-0 p-0">
        <div className="flex items-center justify-between border-b p-2.5">
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
        <div className="flex max-h-96 flex-col">
          <ScrollArea className="min-h-0 flex-1">
            {notifications.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
            ) : (
              <div className="flex flex-col p-1.5">
                {notifications.map((n) => (
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
          </ScrollArea>
        </div>
      </PopoverContent>
    </Popover>
  );
}
