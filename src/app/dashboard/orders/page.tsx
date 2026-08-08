import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCallerContext, resolveActiveTenant } from '@/lib/auth/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { OrdersView } from '@/app/admin/orders/orders-view';
import type { OrderStatus } from '@/app/admin/orders/actions';

const VALID_STATUSES: OrderStatus[] = ['pending', 'confirmed', 'fulfilled', 'cancelled'];

export default async function DashboardOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: statusParam } = await searchParams;
  const initialStatus: OrderStatus | 'all' = VALID_STATUSES.includes(statusParam as OrderStatus)
    ? (statusParam as OrderStatus)
    : 'all';

  const ctx = await getCallerContext(); // layout already gated; re-derive (React cache dedupes)
  if (!ctx) redirect('/login');
  const cookieStore = await cookies();
  const activeTenantId = resolveActiveTenant(ctx, cookieStore.get('cn_active_tenant')?.value);
  if (!activeTenantId) redirect('/dashboard');

  const supabase = await createSupabaseServerClient();

  // Same HttpOnly-cookie constraint as /dashboard/chat: hand Realtime the
  // caller's own access token so postgres_changes RLS authorizes it.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  let ordersQuery = supabase
    .from('orders')
    .select('*')
    .eq('tenant_id', activeTenantId) // explicit; RLS also enforces (docs/13 §5)
    .order('created_at', { ascending: false })
    .limit(25);
  if (initialStatus !== 'all') {
    ordersQuery = ordersQuery.eq('status', initialStatus);
  }

  const [{ data: orders }, { data: memberTenants }] = await Promise.all([
    ordersQuery,
    // Only the caller's own tenant(s) — never the full tenants table (docs/13 §6.3).
    supabase.from('tenants').select('id, business_name').in(
      'id',
      ctx.memberships.map((m) => m.tenantId),
    ),
  ]);

  return (
    <OrdersView
      initialOrders={orders ?? []}
      tenants={memberTenants ?? []}
      realtimeAccessToken={session?.access_token ?? null}
      // Always off here. This dropdown/column pair is agency vocabulary ("all
      // clients") layered on a component that also serves the client shell,
      // where the user IS the client, not one of several the caller manages.
      // With it on, the label lied on first paint (server hard-filters to
      // activeTenantId below, but the dropdown read "All clients" because it
      // was seeded with initialTenantId={null}), and picking a business here
      // didn't move `cn_active_tenant` — so Orders silently drifted onto a
      // different business than the topbar and every other page still showed.
      // The topbar's TenantSwitcher is the one "which business" control now;
      // it's the thing that actually moves the cookie the whole app reads.
      showBusinessColumn={false}
      chatBasePath="/dashboard/chat"
      initialStatus={initialStatus}
      initialTenantId={null}
    />
  );
}
