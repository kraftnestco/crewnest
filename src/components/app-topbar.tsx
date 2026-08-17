import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCallerContext } from '@/lib/auth/context';
import {
  listNotificationsAction,
  getUnreadCountAction,
  listNotificationClientsAction,
} from '@/lib/notifications/actions';
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
export async function AppTopbar({
  accountHref,
  accountTypeLabel,
  accountKind,
  switcher,
}: {
  accountHref: string;
  /**
   * "Agency" or the active business name (docs: account-type indicator) — shown
   * on mobile only, next to the brand, since the sidebar badge that normally
   * carries this is `hidden` below `lg`. Passed down rather than resolved here
   * so both layouts keep owning the one source of truth (platform-admin vs.
   * active-tenant lookup) they already compute for their own sidebar badge.
   */
  accountTypeLabel: string;
  /**
   * Which PORTAL this is — the two shells are otherwise visually identical on a
   * phone (same logo, same topbar, same tab bar). The business-name badge alone
   * doesn't answer "am I in the agency view or a client view?", which is the
   * actual question when one person has both.
   */
  accountKind: 'agency' | 'client';
  /**
   * Optional mobile business switcher, rendered in place of the plain badge.
   * Supplied only by the client dashboard (the agency shell has no active
   * tenant to switch), so this component stays agnostic about tenancy.
   */
  switcher?: React.ReactNode;
}) {
  const [ctx, supabase] = await Promise.all([getCallerContext(), createSupabaseServerClient()]);

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const [notifications, unreadCount, notificationClients] = await Promise.all([
    listNotificationsAction(20),
    getUnreadCountAction(),
    // Agency-only filter option list (docs: admin notification grouping) — a
    // no-op empty array for a tenant-scoped caller, so this stays a single
    // fetch rather than a conditional one.
    listNotificationClientsAction(),
  ]);

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b bg-surface/80 px-4 backdrop-blur-sm lg:px-6">
      <div className="flex min-w-0 items-center gap-2.5">
        {/* Brand + account badges show here on mobile only — the sidebar
            (which carries both on desktop) is hidden below lg. */}
        <span className="flex min-w-0 items-center gap-1.5">
          <Logomark className="size-7 shrink-0 lg:hidden" />
          {/* The wordmark is redundant next to the logomark and was the single
              biggest consumer of a phone topbar's width — with it there, the
              business name in the switcher crushed to "Kraf…". Hidden on the
              narrowest screens; the mark alone still carries the brand. */}
          <span className="hidden font-logo text-lg min-[420px]:inline lg:hidden">ClerkNest</span>
          {/* Portal indicator: only shown on the agency side. The client
              dashboard IS the business's own shell (not "the client view" of
              something else to the owner using it), and a business name
              already sits right next to this (the switcher/label below), so
              a literal "Client" pill was redundant chrome, not information. */}
          {accountKind === 'agency' && (
            <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[0.65rem] font-medium text-primary lg:hidden">
              Agency
            </span>
          )}
          {/* The business name / switcher — mobile only, since the desktop
              sidebar already shows it above its own switcher. Skipped when it
              would just repeat the portal badge (the agency shell passes
              "Agency" as its label and has no business to name). */}
          {(switcher || accountTypeLabel !== 'Agency') && (
            <span className="flex min-w-0 items-center lg:hidden">
              {switcher ?? (
                <span className="max-w-[8rem] truncate rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-medium text-foreground">
                  {accountTypeLabel}
                </span>
              )}
            </span>
          )}
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
          clients={notificationClients}
          scopeKind={accountKind}
        />
        <AccountMenu fullName={ctx?.fullName ?? null} email={ctx?.email ?? null} accountHref={accountHref} />
      </div>
    </header>
  );
}
