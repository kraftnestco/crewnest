import { createSupabaseServerClient } from '@/lib/supabase/server';
import { MIN_CSAT_SAMPLE } from '@/lib/constants';
import { computeCogsFromOrders, countRepeatBuyers, sumOperatingExpenses } from '@/services/finance';
import type { AlertSignal, HandoffCause } from '@/types/domain';

/**
 * docs/16-ANALYTICS-AND-PROOF.md §3/§5 — the proof layer. One function per metric
 * group, each `(tenantId | null, from, to)`: `tenantId=null` is agency-wide (RLS
 * lets a platform admin read all tenants); a real id is tenant-scoped. Computed
 * on-the-fly with indexed range queries — no materialized views in Phase 3 (§3).
 * Server Components only (pulls in `next/headers` via createSupabaseServerClient),
 * same constraint as overview.ts.
 */

export interface DateRange {
  from: string; // ISO, inclusive
  to: string; // ISO, exclusive
}

export interface VolumeMetrics {
  conversationsStarted: number;
  activeConversations: number;
  messagesHandled: number;
}

export interface DeflectionMetrics {
  conversationsStarted: number;
  deflected: number;
  deflectionRate: number | null; // null when conversationsStarted === 0
  /**
   * Counts of sessions (in range) that ever carried each cause, regardless of
   * whether they were later handed back — a diagnostic overlay, not a partition
   * of `deflected`. `alert` is never populated by any code path today (an
   * alert_signal flags a session without forcing a handoff); kept for schema
   * parity with docs/16 §2's cause list and future-proofing.
   */
  handoffByCause: Record<HandoffCause, number>;
}

export interface CostBreakdown {
  totalCostUsd: number;
  byokCostUsd: number;
  masterCostUsd: number;
  costPerConversation: number | null;
  costPerHandledMessage: number | null;
}

export type SentimentBucket = AlertSignal | 'clear';

export interface SentimentHealth {
  activeConversations: number;
  counts: Record<SentimentBucket, number>;
  percentages: Record<SentimentBucket, number>;
}

export interface CsatMetrics {
  averageRating: number | null;
  count: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  sufficientSample: boolean;
}

export interface CommerceMetrics {
  /** Confirmed/fulfilled orders plus booked appointments created in range. */
  outcomesSecured: number;
  ordersSecured: number;
  appointmentsBooked: number;
  /** Accepted orders in range; the denominator for payment conversion. */
  paymentEligibleOrders: number;
  paidOrders: number;
  paymentConversionRate: number | null;
}

/**
 * Owner-facing money metrics for a date range. When catalogue items carry
 * `unit_cost` and operating expenses are logged, netProfit reflects true
 * profit (revenue − refunds − COGS − expenses).
 */
export interface EcommerceMetrics {
  revenuePaid: number;
  refundedAmount: number;
  /** Paid revenue minus refunds in the same window. */
  netRevenue: number;
  /** Product cost of goods sold (paid orders × unit_cost). */
  cogs: number;
  /** Logged business expenses in the same window. */
  operatingExpenses: number;
  /** netRevenue − cogs − operatingExpenses. */
  netProfit: number;
  grossMarginPct: number | null;
  repeatBuyers: number;
  /** Confirmed/fulfilled order totals (includes unpaid). */
  grossSales: number;
  pendingPaymentAmount: number;
  ordersPaid: number;
  ordersSecured: number;
  averageOrderValue: number | null;
  itemsSold: number;
  primaryCurrency: string | null;
  multiCurrency: boolean;
}

export interface PlatformBreakdownRow {
  platform: 'whatsapp' | 'facebook' | 'instagram' | 'web' | 'voice';
  conversationsStarted: number;
  responseRate: number | null;
  performanceRate: number | null; // deflection-like: automated conversations / started
  conversionRate: number | null; // secured orders / started conversations
}

const ALL_HANDOFF_CAUSES: HandoffCause[] = ['requested', 'alert', 'tool_exhaustion', 'media_review'];
const ALL_SENTIMENT_BUCKETS: SentimentBucket[] = [
  'frustrated',
  'price_objection',
  'product_doubt',
  'cancellation_risk',
  'clear',
];

export async function getVolume(tenantId: string | null, range: DateRange): Promise<VolumeMetrics> {
  const supabase = await createSupabaseServerClient();

  let startedQuery = supabase
    .from('chat_sessions')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', range.from)
    .lt('created_at', range.to);
  let activeQuery = supabase
    .from('chat_sessions')
    .select('*', { count: 'exact', head: true })
    .gte('last_message_at', range.from)
    .lt('last_message_at', range.to);
  let handledQuery = supabase
    .from('chat_messages')
    .select('*', { count: 'exact', head: true })
    .eq('role', 'assistant')
    .gte('created_at', range.from)
    .lt('created_at', range.to);

  if (tenantId) {
    startedQuery = startedQuery.eq('tenant_id', tenantId);
    activeQuery = activeQuery.eq('tenant_id', tenantId);
    handledQuery = handledQuery.eq('tenant_id', tenantId);
  }

  const [{ count: conversationsStarted }, { count: activeConversations }, { count: messagesHandled }] =
    await Promise.all([startedQuery, activeQuery, handledQuery]);

  return {
    conversationsStarted: conversationsStarted ?? 0,
    activeConversations: activeConversations ?? 0,
    messagesHandled: messagesHandled ?? 0,
  };
}

export async function getDeflection(tenantId: string | null, range: DateRange): Promise<DeflectionMetrics> {
  const supabase = await createSupabaseServerClient();

  let sessionsQuery = supabase
    .from('chat_sessions')
    .select('id, is_human_handoff, handoff_cause')
    .gte('created_at', range.from)
    .lt('created_at', range.to);
  if (tenantId) sessionsQuery = sessionsQuery.eq('tenant_id', tenantId);

  const { data: sessionRows, error: sessionsError } = await sessionsQuery;
  if (sessionsError) throw sessionsError;

  const sessions = sessionRows ?? [];
  const conversationsStarted = sessions.length;

  const handoffByCause = Object.fromEntries(ALL_HANDOFF_CAUSES.map((c) => [c, 0])) as Record<HandoffCause, number>;
  for (const s of sessions) {
    if (s.handoff_cause && ALL_HANDOFF_CAUSES.includes(s.handoff_cause as HandoffCause)) {
      handoffByCause[s.handoff_cause as HandoffCause] += 1;
    }
  }

  if (conversationsStarted === 0) {
    return { conversationsStarted: 0, deflected: 0, deflectionRate: null, handoffByCause };
  }

  const stillActiveIds = sessions.filter((s) => !s.is_human_handoff).map((s) => s.id);
  if (stillActiveIds.length === 0) {
    return { conversationsStarted, deflected: 0, deflectionRate: 0, handoffByCause };
  }

  // A session is deflected only if it never triggered a handoff/media_review
  // notification (the audit trail) — is_human_handoff alone can be toggled back
  // off after a takeover, which would otherwise over-count (docs/16 §2).
  const [{ data: handedOffRows, error: notifyError }, { data: repliedRows, error: repliedError }] = await Promise.all([
    supabase
      .from('notifications')
      .select('entity_id')
      .eq('entity_type', 'session')
      .in('type', ['handoff', 'media_review'])
      .in('entity_id', stillActiveIds),
    supabase
      .from('chat_messages')
      .select('session_id')
      .eq('role', 'assistant')
      .in('session_id', stillActiveIds),
  ]);
  if (notifyError) throw notifyError;
  if (repliedError) throw repliedError;

  const everHandedOff = new Set((handedOffRows ?? []).map((r) => r.entity_id));
  const everReplied = new Set((repliedRows ?? []).map((r) => r.session_id));

  const deflected = stillActiveIds.filter((id) => !everHandedOff.has(id) && everReplied.has(id)).length;

  return {
    conversationsStarted,
    deflected,
    deflectionRate: deflected / conversationsStarted,
    handoffByCause,
  };
}

export async function getCostBreakdown(tenantId: string | null, range: DateRange): Promise<CostBreakdown> {
  const supabase = await createSupabaseServerClient();

  let usageQuery = supabase
    .from('usage_logs')
    .select('estimated_cost_usd, used_byok')
    .gte('created_at', range.from)
    .lt('created_at', range.to);
  if (tenantId) usageQuery = usageQuery.eq('tenant_id', tenantId);

  const [{ data: usageRows, error: usageError }, volume] = await Promise.all([
    usageQuery,
    getVolume(tenantId, range),
  ]);
  if (usageError) throw usageError;

  let totalCostUsd = 0;
  let byokCostUsd = 0;
  let masterCostUsd = 0;
  for (const row of usageRows ?? []) {
    totalCostUsd += row.estimated_cost_usd;
    if (row.used_byok) byokCostUsd += row.estimated_cost_usd;
    else masterCostUsd += row.estimated_cost_usd;
  }

  return {
    totalCostUsd,
    byokCostUsd,
    masterCostUsd,
    costPerConversation: volume.conversationsStarted > 0 ? totalCostUsd / volume.conversationsStarted : null,
    costPerHandledMessage: volume.messagesHandled > 0 ? totalCostUsd / volume.messagesHandled : null,
  };
}

export async function getSentimentHealth(tenantId: string | null, range: DateRange): Promise<SentimentHealth> {
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from('chat_sessions')
    .select('alert_signal')
    .gte('last_message_at', range.from)
    .lt('last_message_at', range.to);
  if (tenantId) query = query.eq('tenant_id', tenantId);

  const { data, error } = await query;
  if (error) throw error;

  const rows = data ?? [];
  const counts = Object.fromEntries(ALL_SENTIMENT_BUCKETS.map((b) => [b, 0])) as Record<SentimentBucket, number>;
  for (const row of rows) {
    const bucket = (row.alert_signal as SentimentBucket | null) ?? 'clear';
    counts[bucket] += 1;
  }

  const activeConversations = rows.length;
  const percentages = Object.fromEntries(
    ALL_SENTIMENT_BUCKETS.map((b) => [b, activeConversations > 0 ? counts[b] / activeConversations : 0]),
  ) as Record<SentimentBucket, number>;

  return { activeConversations, counts, percentages };
}

export async function getCsat(tenantId: string | null, range: DateRange): Promise<CsatMetrics> {
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from('orders')
    .select('review_rating')
    .eq('status', 'fulfilled')
    .not('review_rating', 'is', null)
    .gte('review_submitted_at', range.from)
    .lt('review_submitted_at', range.to);
  if (tenantId) query = query.eq('tenant_id', tenantId);

  const { data, error } = await query;
  if (error) throw error;

  const ratings = (data ?? []).map((r) => r.review_rating).filter((r): r is number => r !== null);
  const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of ratings) {
    if (r >= 1 && r <= 5) distribution[r as 1 | 2 | 3 | 4 | 5] += 1;
  }

  const count = ratings.length;
  const averageRating = count > 0 ? ratings.reduce((sum, r) => sum + r, 0) / count : null;

  return { averageRating, count, distribution, sufficientSample: count >= MIN_CSAT_SAMPLE };
}

/**
 * Revenue-proxy outcomes derived from existing order/appointment rows. "Secured"
 * deliberately excludes pending and cancelled orders; payment conversion is
 * current paid status among accepted (confirmed/fulfilled) orders, so refunded
 * or failed payments do not read as collected revenue.
 */
export async function getCommerceMetrics(tenantId: string | null, range: DateRange): Promise<CommerceMetrics> {
  const supabase = await createSupabaseServerClient();

  let ordersQuery = supabase
    .from('orders')
    .select('status, payment_status')
    .in('status', ['confirmed', 'fulfilled'])
    .gte('created_at', range.from)
    .lt('created_at', range.to);
  let appointmentsQuery = supabase
    .from('appointments')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'booked')
    .gte('created_at', range.from)
    .lt('created_at', range.to);

  if (tenantId) {
    ordersQuery = ordersQuery.eq('tenant_id', tenantId);
    appointmentsQuery = appointmentsQuery.eq('tenant_id', tenantId);
  }

  const [{ data: orderRows, error: ordersError }, { count: appointmentsBooked, error: appointmentsError }] =
    await Promise.all([ordersQuery, appointmentsQuery]);
  if (ordersError) throw ordersError;
  if (appointmentsError) throw appointmentsError;

  const orders = orderRows ?? [];
  const ordersSecured = orders.length;
  const paidOrders = orders.filter((order) => order.payment_status === 'paid').length;
  const paymentConversionRate = ordersSecured > 0 ? paidOrders / ordersSecured : null;

  return {
    outcomesSecured: ordersSecured + (appointmentsBooked ?? 0),
    ordersSecured,
    appointmentsBooked: appointmentsBooked ?? 0,
    paymentEligibleOrders: ordersSecured,
    paidOrders,
    paymentConversionRate,
  };
}

function sumOrderAmounts(
  rows: Array<{ amount_total: number | null; currency: string | null; payment_status: string; status: string; items: unknown }>,
): EcommerceMetrics {
  const currencyTotals = new Map<string, number>();
  let revenuePaid = 0;
  let refundedAmount = 0;
  let grossSales = 0;
  let pendingPaymentAmount = 0;
  let ordersPaid = 0;
  let ordersSecured = 0;
  let itemsSold = 0;
  let paidAmountForAov = 0;

  for (const row of rows) {
    const amount = typeof row.amount_total === 'number' && Number.isFinite(row.amount_total) ? row.amount_total : 0;
    const currency = row.currency?.trim() || '_';
    currencyTotals.set(currency, (currencyTotals.get(currency) ?? 0) + amount);

    const secured = row.status === 'confirmed' || row.status === 'fulfilled';
    if (secured) {
      ordersSecured += 1;
      grossSales += amount;
      if (Array.isArray(row.items)) {
        for (const item of row.items) {
          if (item && typeof item === 'object' && 'qty' in item) {
            const qty = Number((item as { qty?: unknown }).qty);
            if (Number.isFinite(qty) && qty > 0) itemsSold += qty;
          }
        }
      }
    }

    if (row.payment_status === 'paid') {
      revenuePaid += amount;
      ordersPaid += 1;
      paidAmountForAov += amount;
    } else if (row.payment_status === 'refunded') {
      refundedAmount += amount;
    } else if (secured && (row.payment_status === 'unpaid' || row.payment_status === 'awaiting_verification')) {
      pendingPaymentAmount += amount;
    }
  }

  const currencies = [...currencyTotals.keys()].filter((c) => c !== '_');
  let primaryCurrency: string | null = null;
  if (currencies.length > 0) {
    primaryCurrency = currencies.sort((a, b) => (currencyTotals.get(b) ?? 0) - (currencyTotals.get(a) ?? 0))[0] ?? null;
  }

  return {
    revenuePaid,
    refundedAmount,
    netRevenue: revenuePaid - refundedAmount,
    cogs: 0,
    operatingExpenses: 0,
    netProfit: revenuePaid - refundedAmount,
    grossMarginPct: null,
    repeatBuyers: 0,
    grossSales,
    pendingPaymentAmount,
    ordersPaid,
    ordersSecured,
    averageOrderValue: ordersPaid > 0 ? paidAmountForAov / ordersPaid : null,
    itemsSold,
    primaryCurrency,
    multiCurrency: currencies.length > 1,
  };
}

/**
 * Revenue / net / AOV snapshot for the owner dashboard and analytics page.
 * Includes cancelled rows only when they were refunded (so refunds still show).
 */
export async function getEcommerceMetrics(tenantId: string | null, range: DateRange): Promise<EcommerceMetrics> {
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from('orders')
    .select('status, payment_status, amount_total, currency, items')
    .gte('created_at', range.from)
    .lt('created_at', range.to)
    .or('status.in.(confirmed,fulfilled),payment_status.eq.refunded');

  if (tenantId) query = query.eq('tenant_id', tenantId);

  const catalogPromise = tenantId
    ? supabase.from('tenants').select('catalog_data').eq('id', tenantId).single()
    : Promise.resolve({ data: null, error: null });

  const [{ data, error }, catalogRes] = await Promise.all([query, catalogPromise]);
  if (error) throw error;

  const base = sumOrderAmounts(data ?? []);
  if (!tenantId) return base;

  const catalogData = catalogRes.data?.catalog_data ?? null;
  const cogs = computeCogsFromOrders(data ?? [], catalogData);
  const operatingExpenses = await sumOperatingExpenses(tenantId, range);
  const repeatBuyers = await countRepeatBuyers(tenantId, range);
  const netProfit = base.netRevenue - cogs - operatingExpenses;
  const grossMarginPct =
    base.netRevenue > 0 && cogs > 0 ? ((base.netRevenue - cogs) / base.netRevenue) * 100 : null;

  return {
    ...base,
    cogs,
    operatingExpenses,
    netProfit,
    grossMarginPct,
    repeatBuyers,
  };
}

/**
 * Per-platform performance slice for the client analytics page: response,
 * automation performance, and conversion shown separately for each channel.
 */
export async function getPlatformBreakdown(
  tenantId: string | null,
  range: DateRange,
): Promise<PlatformBreakdownRow[]> {
  const supabase = await createSupabaseServerClient();

  let sessionsQuery = supabase
    .from('chat_sessions')
    .select('id, platform, is_human_handoff')
    .gte('created_at', range.from)
    .lt('created_at', range.to);
  let repliesQuery = supabase
    .from('chat_messages')
    .select('session_id')
    .eq('role', 'assistant')
    .gte('created_at', range.from)
    .lt('created_at', range.to);
  let ordersQuery = supabase
    .from('orders')
    .select('platform, status')
    .in('status', ['confirmed', 'fulfilled'])
    .gte('created_at', range.from)
    .lt('created_at', range.to);

  if (tenantId) {
    sessionsQuery = sessionsQuery.eq('tenant_id', tenantId);
    repliesQuery = repliesQuery.eq('tenant_id', tenantId);
    ordersQuery = ordersQuery.eq('tenant_id', tenantId);
  }

  const [{ data: sessions, error: sessionsError }, { data: replies, error: repliesError }, { data: orders, error: ordersError }] =
    await Promise.all([sessionsQuery, repliesQuery, ordersQuery]);
  if (sessionsError) throw sessionsError;
  if (repliesError) throw repliesError;
  if (ordersError) throw ordersError;

  const platforms: PlatformBreakdownRow['platform'][] = ['whatsapp', 'instagram', 'facebook', 'web'];
  const repliedSessionIds = new Set((replies ?? []).map((row) => row.session_id));

  return platforms.map((platform) => {
    const platformSessions = (sessions ?? []).filter((s) => s.platform === platform);
    const conversationsStarted = platformSessions.length;
    const responded = platformSessions.filter((s) => repliedSessionIds.has(s.id)).length;
    const automated = platformSessions.filter((s) => !s.is_human_handoff).length;
    const securedOrders = (orders ?? []).filter((o) => o.platform === platform).length;

    return {
      platform,
      conversationsStarted,
      responseRate: conversationsStarted > 0 ? responded / conversationsStarted : null,
      performanceRate: conversationsStarted > 0 ? automated / conversationsStarted : null,
      conversionRate: conversationsStarted > 0 ? securedOrders / conversationsStarted : null,
    };
  });
}
