import { createSupabaseServerClient } from '@/lib/supabase/server';
import { OrdersView } from './orders-view';

export default async function OrdersPage() {
  const supabase = await createSupabaseServerClient();

  // Same HttpOnly-cookie constraint as /admin/chat: hand Realtime the access
  // token once so postgres_changes RLS authorizes the browser client.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const [{ data: orders }, { data: tenants }] = await Promise.all([
    supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(25),
    supabase.from('tenants').select('id, business_name'),
  ]);

  return (
    <OrdersView
      initialOrders={orders ?? []}
      tenants={tenants ?? []}
      realtimeAccessToken={session?.access_token ?? null}
    />
  );
}
