import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { OrderStatus } from './actions';
import { OrdersView } from './orders-view';

const VALID_STATUSES: OrderStatus[] = ['pending', 'confirmed', 'fulfilled', 'cancelled'];

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: statusParam } = await searchParams;
  const initialStatus: OrderStatus | 'all' = VALID_STATUSES.includes(statusParam as OrderStatus)
    ? (statusParam as OrderStatus)
    : 'all';

  const supabase = await createSupabaseServerClient();

  // Same HttpOnly-cookie constraint as /admin/chat: hand Realtime the access
  // token once so postgres_changes RLS authorizes the browser client.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  let ordersQuery = supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(25);
  if (initialStatus !== 'all') {
    ordersQuery = ordersQuery.eq('status', initialStatus);
  }

  const [{ data: orders }, { data: tenants }] = await Promise.all([
    ordersQuery,
    supabase.from('tenants').select('id, business_name'),
  ]);

  return (
    <OrdersView
      initialOrders={orders ?? []}
      tenants={tenants ?? []}
      realtimeAccessToken={session?.access_token ?? null}
      initialStatus={initialStatus}
    />
  );
}
