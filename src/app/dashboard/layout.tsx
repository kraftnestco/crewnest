import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCallerContext, resolveActiveTenant } from '@/lib/auth/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { AppTopbar } from '@/components/app-topbar';
import { signOutAction } from '@/app/admin/actions';
import { Logomark } from '@/app/_landing/logomark';
import { DashboardNav, DashboardTabBar } from './dashboard-nav';
import { TenantSwitcher } from './tenant-switcher';
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
          <h1 className="font-heading text-lg font-semibold">Access pending</h1>
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
    .select('id, business_name')
    .in(
      'id',
      ctx.memberships.map((m) => m.tenantId),
    );
  if (tenantsError) {
    log.error('[dashboard/layout] member tenants lookup failed', { userId: ctx.userId, error: tenantsError.message });
  }
  const tenantNameMap = new Map((memberTenants ?? []).map((t) => [t.id, t.business_name]));
  const activeTenantName = activeTenantId ? (tenantNameMap.get(activeTenantId) ?? 'My Business') : 'My Business';

  const showBusiness = activeMembership?.role === 'tenant_admin';

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar — hidden below lg; phones use the bottom tab bar instead. */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2.5 p-4">
          <Logomark className="size-7" />
          <div className="min-w-0">
            <p className="font-heading text-sm font-semibold">CrewNest</p>
            <p className="truncate text-xs text-muted-foreground">{activeTenantName}</p>
          </div>
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
        <DashboardNav showBusiness={showBusiness} />
        <div className="border-t border-sidebar-border p-3">
          <p className="truncate px-1 text-xs text-muted-foreground">{ctx.fullName || ctx.email}</p>
          <form action={signOutAction} className="mt-2">
            <Button type="submit" variant="outline" size="sm" className="w-full">
              Sign out
            </Button>
          </form>
        </div>
      </aside>
      <div className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
        <AppTopbar accountHref="/dashboard/account" />
        {/* pb-16 keeps content clear of the fixed mobile tab bar. */}
        <main className="min-h-0 flex-1 overflow-y-auto pb-16 lg:pb-0">{children}</main>
        <DashboardTabBar showBusiness={showBusiness} />
      </div>
    </div>
  );
}
