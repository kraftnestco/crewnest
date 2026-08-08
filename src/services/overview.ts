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

export interface AttentionItem {
  id: string;
  /** Human sentence, not a mechanism word (docs/27 §0.1) — e.g. "Ayesha's order needs your approval". */
  sentence: string;
  timestamp: string;
  href: string;
}

const ALERT_SIGNAL_PHRASE: Record<string, string> = {
  frustrated: 'seems frustrated',
  price_objection: 'is pushing back on price',
  product_doubt: "isn't sure about the product",
  cancellation_risk: 'might cancel',
};

/**
 * docs/27 §7.2 — row-level detail behind `getTenantNeedsAttention`'s counts.
 * The client Home needs a human sentence per item, not a number, so this pulls
 * the newest few rows from each of the four count queries and merges them by
 * recency. Each source query is capped at `limit` — enough to guarantee the
 * true global top-`limit` by recency, since at most `limit` of the final rows
 * can come from any one source. `total` still reflects every outstanding item,
 * for the "N more" overflow line, even though only `limit` rows are returned.
 */
export async function getTenantAttentionItems(tenantId: string, limit = 5): Promise<{ items: AttentionItem[]; total: number }> {
  const supabase = await createSupabaseServerClient();

  const [
    { data: pendingOrders, count: pendingCount },
    { data: paymentOrders, count: paymentCount },
    { data: handoffSessions, count: handoffCount },
    { data: flaggedSessions, count: flaggedCount },
  ] = await Promise.all([
    supabase
      .from('orders')
      .select('id, order_number, customer_name, created_at', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('orders')
      .select('id, order_number, customer_name, created_at', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('payment_status', 'awaiting_verification')
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('chat_sessions')
      .select('id, customer_name, last_message_at', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('is_human_handoff', true)
      .order('last_message_at', { ascending: false })
      .limit(limit),
    supabase
      .from('chat_sessions')
      .select('id, customer_name, alert_signal, last_message_at', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .not('alert_signal', 'is', null)
      .order('last_message_at', { ascending: false })
      .limit(limit),
  ]);

  const rows: (AttentionItem & { at: number })[] = [
    ...(pendingOrders ?? []).map((o) => ({
      id: `order-${o.id}`,
      sentence: `${o.customer_name ?? (o.order_number ? `Order #${o.order_number}` : 'An order')} needs your approval`,
      timestamp: o.created_at,
      at: new Date(o.created_at).getTime(),
      href: '/dashboard/orders?status=pending',
    })),
    ...(paymentOrders ?? []).map((o) => ({
      id: `payment-${o.id}`,
      sentence: `${o.customer_name ?? (o.order_number ? `Order #${o.order_number}` : 'An order')} — payment needs verifying`,
      timestamp: o.created_at,
      at: new Date(o.created_at).getTime(),
      href: '/dashboard/orders',
    })),
    ...(handoffSessions ?? []).map((s) => ({
      id: `handoff-${s.id}`,
      sentence: `${s.customer_name ?? 'A customer'} is waiting for a reply`,
      timestamp: s.last_message_at,
      at: new Date(s.last_message_at).getTime(),
      href: `/dashboard/chat?session=${s.id}`,
    })),
    ...(flaggedSessions ?? []).map((s) => ({
      id: `flagged-${s.id}`,
      sentence: `${s.customer_name ?? 'A customer'} ${ALERT_SIGNAL_PHRASE[s.alert_signal ?? ''] ?? 'needs a look'}`,
      timestamp: s.last_message_at,
      at: new Date(s.last_message_at).getTime(),
      href: `/dashboard/chat?session=${s.id}`,
    })),
  ];

  rows.sort((a, b) => b.at - a.at);

  return {
    items: rows.slice(0, limit).map(({ id, sentence, timestamp, href }) => ({ id, sentence, timestamp, href })),
    total: (pendingCount ?? 0) + (paymentCount ?? 0) + (handoffCount ?? 0) + (flaggedCount ?? 0),
  };
}
