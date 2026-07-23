import { createSupabaseServerClient } from '@/lib/supabase/server';
import { MIN_CSAT_SAMPLE } from '@/lib/constants';
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
