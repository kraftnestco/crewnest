import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCallerContext } from '@/lib/auth/context';
import { listNotificationsAction, getUnreadCountAction } from '@/lib/notifications/actions';
import { NotificationBell } from '@/components/notification-bell';
import { AccountMenu } from '@/components/account-menu';
import { ThemeToggle } from '@/components/theme-toggle';
import { Logomark } from '@/app/_landing/logomark';
import { TopbarHeadingSlot, TopbarActionsSlot } from '@/components/topbar-heading';

/**
 * Slim top bar (docs/14 §4.2/§7.1) hosting the notification bell + account menu.
 * Also hosts the active page's title/description/actions on desktop
 * (`TopbarHeadingSlot`/`TopbarActionsSlot`, published by that page's `PageHeader`)
 * so they're always visible without scrolling down into the page body.
 * Mounted once per shell layout. Server Component: fetches the initial notification
 * list/count and the Realtime access token server-side (same reason as inbox.tsx —
 * the auth cookie is HttpOnly, so the browser client can't read its own session).
 */
export async function AppTopbar({ accountHref }: { accountHref: string }) {
  const [ctx, supabase] = await Promise.all([getCallerContext(), createSupabaseServerClient()]);

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const [notifications, unreadCount] = await Promise.all([listNotificationsAction(20), getUnreadCountAction()]);

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-sm lg:px-6">
      <div className="flex min-w-0 items-center gap-2.5">
        {/* Brand shows here on mobile only — the sidebar (which carries it on desktop) is hidden below lg. */}
        <span className="flex items-center gap-2 lg:hidden">
          <Logomark className="size-7" />
          <span className="font-hero-display text-lg">CrewNest</span>
        </span>
        <TopbarHeadingSlot />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <TopbarActionsSlot />
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
