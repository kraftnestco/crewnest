import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCallerContext, resolveActiveTenant } from '@/lib/auth/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/page-header';
import { readInventory } from '@/services/inventory';
import { InventoryPanel } from './inventory-panel';

/**
 * Inventory Lite (docs/19 I1) — the tenant-admin's stock screen. Reads the same
 * `catalog_data` the assistant is grounded on and renders each item's optional
 * `stock` field for one-tap editing. Tenant-admin only (staff get inbox/orders).
 */
export default async function DashboardInventoryPage() {
  const ctx = await getCallerContext(); // layout already gated; re-derive (React cache dedupes)
  if (!ctx) redirect('/login');
  const cookieStore = await cookies();
  const activeTenantId = resolveActiveTenant(ctx, cookieStore.get('cn_active_tenant')?.value);
  if (!activeTenantId) redirect('/dashboard');

  const activeMembership = ctx.memberships.find((m) => m.tenantId === activeTenantId);
  if (!ctx.isPlatformAdmin && activeMembership?.role !== 'tenant_admin') {
    // Staff (tenant_agent) get inbox + orders only — no business editing (docs/13 §9).
    redirect('/dashboard');
  }

  const supabase = await createSupabaseServerClient();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, business_name, catalog_data')
    .eq('id', activeTenantId)
    .single();

  if (!tenant) redirect('/dashboard');

  const items = readInventory(tenant.catalog_data);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <PageHeader
        title="My Stock"
        description="Set a stock count on any catalogue item. Your assistant stops taking orders once it sells out, and we nudge you to restock. Tracking is optional and per item."
      />
      <InventoryPanel tenantId={activeTenantId} items={items} />
    </div>
  );
}
