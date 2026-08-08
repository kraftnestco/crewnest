import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Inbox } from './inbox';

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const { session: deepLinkSessionId } = await searchParams;
  const supabase = await createSupabaseServerClient();

  // Auth cookies are HttpOnly (docs/02-SECURITY.md §3), so the browser client can't
  // read the session itself. Hand it the access token once so it can authorize
  // Realtime; see the `realtime.setAuth()` call in inbox.tsx.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const [{ data: sessions }, { data: tenants }] = await Promise.all([
    supabase
      .from('chat_sessions')
      .select(
        'id, tenant_id, platform, external_user_id, customer_name, customer_avatar_url, is_human_handoff, alert_signal, handoff_cause, length_limit_reset_at, last_message_at, unread_count, pending_review_order_id, pending_clarification, summary, summary_through_message_at, delivery_blocked_reason, created_at',
      )
      .order('last_message_at', { ascending: false })
      .limit(100),
    supabase.from('tenants').select('id, business_name, system_prompt, catalog_data, payments_enabled, payment_methods'),
  ]);

  const tenantMap = new Map((tenants ?? []).map((t) => [t.id, t]));
  const initialSessions = (sessions ?? []).map((s) => ({
    ...s,
    tenantName: tenantMap.get(s.tenant_id)?.business_name ?? 'Unknown',
  }));

  return (
    <Inbox
      initialSessions={initialSessions}
      tenants={tenants ?? []}
      realtimeAccessToken={session?.access_token ?? null}
      initialSelectedId={deepLinkSessionId ?? null}
    />
  );
}
