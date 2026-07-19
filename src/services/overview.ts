import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface NeedsAttentionCounts {
  ordersToApprove: number;
  paymentsToVerify: number;
  liveHandoffs: number;
  flaggedChats: number;
  channelRequests: number;
}

/**
 * docs/14 §5.2: one shared implementation for the agency Overview (§5.1) and the
 * client home (§6) so the two "Needs attention" surfaces can't drift. Both run
 * through the RLS server client — the tenant variant is auto-scoped by RLS, the
 * agency variant sees all tenants. Callers are Server Components only (this
 * pulls in `next/headers` via createSupabaseServerClient), unlike notifications.ts.
 */
async function countNeedsAttention(tenantId: string | null): Promise<NeedsAttentionCounts> {
  const supabase = await createSupabaseServerClient();

  let ordersToApproveQuery = supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'pending');
  let paymentsToVerifyQuery = supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('payment_status', 'awaiting_verification');
  let liveHandoffsQuery = supabase
    .from('chat_sessions')
    .select('*', { count: 'exact', head: true })
    .eq('is_human_handoff', true);
  let flaggedChatsQuery = supabase
    .from('chat_sessions')
    .select('*', { count: 'exact', head: true })
    .not('alert_signal', 'is', null);
  let channelRequestsQuery = supabase
    .from('tenants')
    .select('*', { count: 'exact', head: true })
    .not('requested_platforms', 'eq', '{}');

  if (tenantId) {
    ordersToApproveQuery = ordersToApproveQuery.eq('tenant_id', tenantId);
    paymentsToVerifyQuery = paymentsToVerifyQuery.eq('tenant_id', tenantId);
    liveHandoffsQuery = liveHandoffsQuery.eq('tenant_id', tenantId);
    flaggedChatsQuery = flaggedChatsQuery.eq('tenant_id', tenantId);
    channelRequestsQuery = channelRequestsQuery.eq('id', tenantId);
  }

  const [
    { count: ordersToApprove },
    { count: paymentsToVerify },
    { count: liveHandoffs },
    { count: flaggedChats },
    { count: channelRequests },
  ] = await Promise.all([
    ordersToApproveQuery,
    paymentsToVerifyQuery,
    liveHandoffsQuery,
    flaggedChatsQuery,
    channelRequestsQuery,
  ]);

  return {
    ordersToApprove: ordersToApprove ?? 0,
    paymentsToVerify: paymentsToVerify ?? 0,
    liveHandoffs: liveHandoffs ?? 0,
    flaggedChats: flaggedChats ?? 0,
    channelRequests: channelRequests ?? 0,
  };
}

/** Agency-wide counts (docs/14 §5.1) — RLS lets platform admins see every tenant. */
export async function getAgencyNeedsAttention(): Promise<NeedsAttentionCounts> {
  return countNeedsAttention(null);
}

/** Tenant-scoped counts (docs/14 §6) — same shape, filtered to one business. */
export async function getTenantNeedsAttention(tenantId: string): Promise<NeedsAttentionCounts> {
  return countNeedsAttention(tenantId);
}
