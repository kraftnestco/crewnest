import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { OrderRange, OrderStatus } from './actions';
import { OrdersView } from './orders-view';

const VALID_STATUSES: OrderStatus[] = ['pending', 'confirmed', 'fulfilled', 'cancelled'];
const VALID_RANGES: OrderRange[] = ['all', '7d', '30d', '90d'];

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; tenant?: string; range?: string }>;
}) {
  const { status: statusParam, tenant: tenantParam, range: rangeParam } = await searchParams;
  const initialStatus: OrderStatus | 'all' = VALID_STATUSES.includes(statusParam as OrderStatus)
    ? (statusParam as OrderStatus)
    : 'all';
  const initialRange: OrderRange = VALID_RANGES.includes(rangeParam as OrderRange) ? (rangeParam as OrderRange) : 'all';

  const supabase = await createSupabaseServerClient();

  // Same HttpOnly-cookie constraint as /admin/chat: hand Realtime the access
  // token once so postgres_changes RLS authorizes the browser client.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const [{ data: tenants }] = await Promise.all([supabase.from('tenants').select('id, business_name')]);

  // `?tenant=` is only honoured if it's a real tenant id — an unrecognised
  // value (stale link, typo) falls back to "all clients" rather than silently
  // returning zero rows with no explanation.
  const initialTenantId =
    tenantParam && tenants?.some((t) => t.id === tenantParam) ? tenantParam : null;

  let ordersQuery = supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(25);
  if (initialStatus !== 'all') {
    ordersQuery = ordersQuery.eq('status', initialStatus);
  }
  if (initialTenantId) {
    ordersQuery = ordersQuery.eq('tenant_id', initialTenantId);
  }
  if (initialRange !== 'all') {
    const now = Date.now();
    const days = initialRange === '7d' ? 7 : initialRange === '30d' ? 30 : 90;
    ordersQuery = ordersQuery.gte('created_at', new Date(now - days * 24 * 60 * 60 * 1000).toISOString());
  }

  const { data: orders } = await ordersQuery;

  return (
    <OrdersView
      initialOrders={orders ?? []}
      tenants={tenants ?? []}
      realtimeAccessToken={session?.access_token ?? null}
      initialStatus={initialStatus}
      initialTenantId={initialTenantId}
      initialRange={initialRange}
    />
  );
}
