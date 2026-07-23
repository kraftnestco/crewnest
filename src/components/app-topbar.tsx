import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCallerContext } from '@/lib/auth/context';
import { listNotificationsAction, getUnreadCountAction } from '@/lib/notifications/actions';
import { NotificationBell } from '@/components/notification-bell';
import { AccountMenu } from '@/components/account-menu';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * Slim top bar (docs/14 §4.2/§7.1) hosting the notification bell + account menu.
 * Mounted once per shell layout. Server Component: fetches the initial notification
 * list/count and the Realtime access token server-side (same reason as inbox.tsx —
 * the auth cookie is HttpOnly, so the browser client can't read its own session).
 */
export async function AppTopbar({ accountHref, title }: { accountHref: string; title?: string }) {
  const [ctx, supabase] = await Promise.all([getCallerContext(), createSupabaseServerClient()]);

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const [notifications, unreadCount] = await Promise.all([listNotificationsAction(20), getUnreadCountAction()]);

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b bg-background/80 px-6 backdrop-blur-sm">
      <p className="truncate text-sm font-medium text-foreground">{title ?? ''}</p>
      <div className="flex shrink-0 items-center gap-2">
        <ThemeToggle />
        <NotificationBell
          initialNotifications={notifications}
          initialUnreadCount={unreadCount}
          realtimeAccessToken={session?.access_token ?? null}
        />
        <AccountMenu fullName={ctx?.fullName ?? null} email={ctx?.email ?? null} accountHref={accountHref} />
      </div>
    </header>
  );
}
