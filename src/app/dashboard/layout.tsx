import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCallerContext, resolveActiveTenant } from '@/lib/auth/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { AppTopbar } from '@/components/app-topbar';
import { TopbarHeadingProvider } from '@/components/topbar-heading';
import { signOutAction } from '@/app/admin/actions';
import { Logomark } from '@/app/_landing/logomark';
import { DashboardNav, DashboardTabBar } from './dashboard-nav';
import { MobileTenantSwitcher, TenantSwitcher } from './tenant-switcher';
import { log } from '@/lib/log';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCallerContext();
  if (!ctx) {
    redirect('/login');
  }

  if (ctx.isPlatformAdmin) {
    // Agency staff use the /admin tree; keep the tenant view exclusively for clients.
    redirect('/admin');
  }

  if (ctx.memberships.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-xl bg-card p-6 text-center ring-1 ring-foreground/10">
          <h1 className="font-hero-display text-lg">Access pending</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your account isn&apos;t linked to a business yet. Ask your CrewNest contact to grant access.
          </p>
          <form action={signOutAction} className="mt-4">
            <Button type="submit" variant="outline" className="w-full">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    );
  }

  const cookieStore = await cookies();
  const activeTenantId = resolveActiveTenant(ctx, cookieStore.get('cn_active_tenant')?.value);
  const activeMembership = ctx.memberships.find((m) => m.tenantId === activeTenantId);

  const supabase = await createSupabaseServerClient();
  const { data: memberTenants, error: tenantsError } = await supabase
    .from('tenants')
    .select('id, business_name, business_type, booking_enabled')
    .in(
      'id',
      ctx.memberships.map((m) => m.tenantId),
    );
  if (tenantsError) {
    log.error('[dashboard/layout] member tenants lookup failed', { userId: ctx.userId, error: tenantsError.message });
  }
  const tenantNameMap = new Map((memberTenants ?? []).map((t) => [t.id, t.business_name]));
  // Single source of truth for the sidebar badge AND the mobile topbar badge below
  // — computed once so the two can't drift apart.
  const activeTenantName = tenantNameMap.get(activeTenantId ?? '') ?? 'Client';

  const showBusiness = activeMembership?.role === 'tenant_admin';
  // Appointments nav only for a service business that has booking switched on
  // (docs/24) — otherwise the page is permanently empty.
  const activeTenantRow = (memberTenants ?? []).find((t) => t.id === activeTenantId);
  const showBookings = activeTenantRow?.business_type === 'service' && Boolean(activeTenantRow?.booking_enabled);

  return (
    <TopbarHeadingProvider>
      {/*
        `h-dvh` + `overflow-hidden`, NOT `min-h-screen`.

        `min-h-screen` is 100vh, and on mobile 100vh is the LARGE viewport —
        the height with browser chrome HIDDEN. The inner column is `h-dvh`
        (the height actually visible right now). Whenever the URL bar is
        showing, the outer box was therefore taller than the screen by exactly
        the bar's height, so the DOCUMENT itself became scrollable: scrolling
        down slid the whole shell up, lifting the bottom tab bar off the
        bottom edge and exposing empty space beneath it. Matching both to
        `dvh` and clipping here means only <main> ever scrolls.
      */}
      <div className="flex h-dvh overflow-hidden">
        {/* Desktop sidebar — hidden below lg; phones use the bottom tab bar instead. */}
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
          <div className="flex items-center gap-3 p-4">
            <Logomark className="size-8" />
            <div className="min-w-0">
              <p className="font-logo text-2xl leading-none">CrewNest</p>
              <p className="mt-1 truncate text-[0.7rem] text-muted-foreground">By KraftNest Automations</p>
            </div>
          </div>
          {/* Account-type indicator — the admin (/admin) and client (/dashboard)
              shells otherwise look identical (same logo, same topbar component),
              so this is the only always-visible cue for which one you're in and,
              for a multi-tenant member, which business is currently active. */}
          <div className="px-4 pb-3">
            <span className="inline-flex max-w-full items-center truncate rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-medium text-foreground">
              {activeTenantName}
            </span>
          </div>
          {ctx.memberships.length > 1 && (
            <TenantSwitcher
              activeTenantId={activeTenantId}
              tenants={ctx.memberships.map((m) => ({
                tenantId: m.tenantId,
                name: tenantNameMap.get(m.tenantId) ?? m.tenantId,
              }))}
            />
          )}
          <DashboardNav showBusiness={showBusiness} showBookings={showBookings} />
          <div className="border-t border-sidebar-border p-3">
            <p className="truncate px-1 text-xs text-muted-foreground">{ctx.fullName || ctx.email}</p>
            <form action={signOutAction} className="mt-2">
              <Button type="submit" variant="outline" size="sm" className="w-full">
                Sign out
              </Button>
            </form>
          </div>
        </aside>
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <AppTopbar
            accountHref="/dashboard/account"
            accountTypeLabel={activeTenantName}
            accountKind="client"
            switcher={
              <MobileTenantSwitcher
                activeTenantId={activeTenantId}
                activeTenantName={activeTenantName}
                tenants={ctx.memberships.map((m) => ({
                  tenantId: m.tenantId,
                  name: tenantNameMap.get(m.tenantId) ?? m.tenantId,
                }))}
              />
            }
          />
          {/*
            `overscroll-contain` stops a scroll that reaches this container's
            end from chaining up to the document and triggering the mobile
            browser's pull-to-refresh / URL-bar show-hide, which is what made
            scrolling feel like it "stuck" mid-gesture. `touch-pan-y` keeps
            vertical panning on the compositor rather than waiting on a
            main-thread listener to decide.
          */}
          {/*
            `min-w-0` + `overflow-x-hidden`: the horizontal counterpart to the
            vertical rules above. Without them a single wide child (an orders
            table, a long unbroken id) stretched this column, so the whole PAGE
            scrolled sideways and exposed empty background past the layout —
            and the fixed tab bar stopped lining up with the content. Wide
            children now scroll inside their own container instead.
          */}
          {/*
            No bottom padding. The tab bar below is a SIBLING in this flex
            column (not an overlay), so it already reserves its own height —
            `flex-1` stops this scroller exactly where the bar begins. The
            padding that used to live here was compensating for a `fixed` bar
            that no longer overlaps anything, so it just added ~60-85px of dead
            space under the last row on every page.
          */}
          <main className="min-h-0 min-w-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain">
            {children}
          </main>
          <DashboardTabBar showBusiness={showBusiness} showBookings={showBookings} />
        </div>
      </div>
    </TopbarHeadingProvider>
  );
}
