import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCallerContext, resolveActiveTenant } from '@/lib/auth/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { DashboardInbox } from './dashboard-inbox';

export default async function DashboardChatPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const { session: deepLinkSessionId } = await searchParams;

  const ctx = await getCallerContext(); // layout already gated; re-derive (React cache dedupes)
  if (!ctx) redirect('/login');
  const cookieStore = await cookies();
  const activeTenantId = resolveActiveTenant(ctx, cookieStore.get('cn_active_tenant')?.value);
  if (!activeTenantId) redirect('/dashboard');

  const supabase = await createSupabaseServerClient();

  // Auth cookies are HttpOnly, so the browser client can't read the session
  // itself. Hand it the caller's OWN access token once so it can authorize
  // Realtime — never a platform-admin or another user's token.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const [{ data: sessions }, { data: tenant }] = await Promise.all([
    supabase
      .from('chat_sessions')
      .select(
        'id, tenant_id, platform, external_user_id, customer_name, customer_avatar_url, is_human_handoff, alert_signal, handoff_cause, last_message_at, unread_count, pending_review_order_id, pending_clarification, summary, summary_through_message_at, created_at',
      )
      .eq('tenant_id', activeTenantId) // explicit; RLS also enforces (docs/13 §5)
      .order('last_message_at', { ascending: false })
      .limit(100),
    supabase
      .from('tenants')
      .select('id, business_name, system_prompt, catalog_data, payments_enabled, payment_methods')
      .eq('id', activeTenantId)
      .single(),
  ]);

  if (!tenant) redirect('/dashboard');

  const initialSessions = (sessions ?? []).map((s) => ({ ...s, tenantName: tenant.business_name }));

  return (
    <DashboardInbox
      tenantId={activeTenantId}
      initialSessions={initialSessions}
      tenant={tenant}
      realtimeAccessToken={session?.access_token ?? null}
      initialSelectedId={deepLinkSessionId ?? null}
    />
  );
}
