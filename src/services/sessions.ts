import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import type { Database } from '@/types/database';
import type { AlertSignal, ChatSession, HandoffCause, PendingClarification, Platform } from '@/types/domain';

/**
 * Session lifecycle. Uses the SERVICE client from webhook/after() context.
 * See docs/08 §5.2.
 */

type ChatSessionRow = Database['public']['Tables']['chat_sessions']['Row'];

function mapSession(row: ChatSessionRow): ChatSession {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    platform: row.platform,
    externalUserId: row.external_user_id,
    isHumanHandoff: row.is_human_handoff,
    alertSignal: (row.alert_signal as AlertSignal | null) ?? null,
    handoffCause: (row.handoff_cause as HandoffCause | null) ?? null,
    pendingReviewOrderId: row.pending_review_order_id,
    pendingClarification: (row.pending_clarification as unknown as PendingClarification | null) ?? null,
    customerName: row.customer_name,
    customerAvatarUrl: row.customer_avatar_url,
    summary: row.summary,
    summaryThroughMessageAt: row.summary_through_message_at,
  };
}

/**
 * Count sessions created since UTC midnight for a tenant — the denominator for
 * the free-plan daily new-conversation cap (docs: self-serve signup plan, Phase D).
 */
export async function countSessionsToday(tenantId: string): Promise<number> {
  const client = createServiceClient();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const { count, error } = await client
    .from('chat_sessions')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .gte('created_at', startOfDay.toISOString());

  if (error) throw error;
  return count ?? 0;
}

/**
 * Find the session for (tenant, platform, external user), or create it.
 *
 * `dailyCap`, when passed (free-plan tenants only), bounds how many NEW
 * conversations may start per UTC day — an existing session is always
 * returned regardless of the cap, since it was already counted the day it
 * was created. Returns the literal `'cap_reached'` instead of creating a row
 * when a brand-new conversation would exceed it.
 */
export async function findOrCreate(
  tenantId: string,
  platform: Platform,
  externalUserId: string,
  dailyCap?: number,
  customerName?: string | null,
): Promise<ChatSession | 'cap_reached'> {
  const client = createServiceClient();

  const { data: existing, error: selectError } = await client
    .from('chat_sessions')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('platform', platform)
    .eq('external_user_id', externalUserId)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing) return mapSession(existing);

  if (dailyCap !== undefined) {
    const todayCount = await countSessionsToday(tenantId);
    if (todayCount >= dailyCap) return 'cap_reached';
  }

  const { data: inserted, error: insertError } = await client
    .from('chat_sessions')
    .insert({
      tenant_id: tenantId,
      platform,
      external_user_id: externalUserId,
      customer_name: customerName ?? null,
    })
    .select('*')
    .single();

  if (insertError) {
    // Unique-constraint race: another concurrent webhook created the row first.
    if (insertError.code === '23505') {
      const { data: raced, error: raceError } = await client
        .from('chat_sessions')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('platform', platform)
        .eq('external_user_id', externalUserId)
        .single();
      if (raceError) throw raceError;
      return mapSession(raced);
    }
    throw insertError;
  }

  return mapSession(inserted);
}

/**
 * Toggle the human-handoff flag (used by the AI on [HUMAN_HANDOFF], the media-review
 * paths, and by the inbox Take Over). `cause`, when raising a handoff, is stored
 * alongside the notification each call site already emits — the analytics
 * handoff-rate breakdown reads this column directly (docs/16 §2, §5).
 */
export async function setHandoff(sessionId: string, value: boolean, cause?: HandoffCause): Promise<void> {
  const client = createServiceClient();
  const { error } = await client
    .from('chat_sessions')
    .update({ is_human_handoff: value, ...(value && cause ? { handoff_cause: cause } : {}) })
    .eq('id', sessionId);

  if (error) throw error;
}

/**
 * Record why an outbound reply couldn't be delivered (docs/15-RELIABILITY-AND-
 * DURABILITY.md §6) — currently only 'meta_window' (a continueSession dispatch
 * landed outside Meta's 24h business-initiated-message window). Null = no
 * delivery-window problem, the safe default (migration 0029).
 */
export async function setDeliveryBlockedReason(sessionId: string, reason: string | null): Promise<void> {
  const client = createServiceClient();
  const { error } = await client.from('chat_sessions').update({ delivery_blocked_reason: reason }).eq('id', sessionId);
  if (error) throw error;
}

/**
 * Persist the Live Inbox alert signal detected from the assistant's reply (or clear it
 * with null). Returns whether the value actually changed — `.neq()` can't express a
 * NULL→value transition correctly, so this reads-then-compares-then-writes, letting
 * callers notify only on a real transition rather than every qualifying turn.
 */
export async function setAlertSignal(sessionId: string, signal: AlertSignal | null): Promise<boolean> {
  const client = createServiceClient();

  const { data: current, error: readError } = await client
    .from('chat_sessions')
    .select('alert_signal')
    .eq('id', sessionId)
    .single();
  if (readError) throw readError;

  const changed = current.alert_signal !== signal;

  const { error } = await client
    .from('chat_sessions')
    .update({ alert_signal: signal })
    .eq('id', sessionId);
  if (error) throw error;

  return changed;
}

/**
 * Set (or clear, with null) the order this session owes a post-fulfillment review
 * for — the session-scoped pointer submit_review's registry gate and executor both
 * check (docs: order-event-messaging plan, Phase B). Cleared on submission and on a
 * fresh order being placed in the same session, so a stale prompt never lingers.
 */
export async function setPendingReview(sessionId: string, orderId: string | null): Promise<void> {
  const client = createServiceClient();
  const { error } = await client
    .from('chat_sessions')
    .update({ pending_review_order_id: orderId })
    .eq('id', sessionId);

  if (error) throw error;
}

/**
 * Set (or clear, with null) the session's open human-review flag — raised by
 * `flag_image_ambiguous` and the voice/video human-review paths, resolved by
 * the inbox's clarification panel (docs: media-handoff plan, Phase B).
 */
export async function setPendingClarification(
  sessionId: string,
  value: PendingClarification | null,
): Promise<void> {
  const client = createServiceClient();
  const { error } = await client
    .from('chat_sessions')
    .update({ pending_clarification: value as unknown as Database['public']['Tables']['chat_sessions']['Update']['pending_clarification'] })
    .eq('id', sessionId);

  if (error) throw error;
}

/**
 * Server-authoritative unread reset — called when staff actually opens a conversation
 * (docs/18 §4 finding #9). The inbox already does an ephemeral client-side `unread_count: 0`
 * on select for instant feedback; this persists it so a page reload or a second staff
 * member's inbox doesn't see a stale unread badge.
 */
export async function markRead(sessionId: string): Promise<void> {
  const client = createServiceClient();
  const { error } = await client.from('chat_sessions').update({ unread_count: 0 }).eq('id', sessionId);

  if (error) throw error;
}

/**
 * Store a refreshed rolling summary and advance the boundary it covers (docs/18 §2,
 * Stage U-mem) — called from the best-effort refresh step in `runTurn`, never
 * user-facing, so a failure here should just be logged by the caller, not surfaced.
 */
export async function setSummary(sessionId: string, summary: string, throughMessageAt: string): Promise<void> {
  const client = createServiceClient();
  const { error } = await client
    .from('chat_sessions')
    .update({ summary, summary_through_message_at: throughMessageAt })
    .eq('id', sessionId);

  if (error) throw error;
}

/**
 * Best-effort backfill of the customer's real name/photo once resolved via a Graph
 * API lookup (Messenger/Instagram — docs/06 §1.1). WhatsApp never calls this: its
 * name arrives synchronously in the webhook payload and is passed to `findOrCreate`
 * directly instead, and WhatsApp has no photo, ever (Cloud API platform limitation).
 * Only fills in fields that are still null so a later, less-complete lookup can
 * never clobber an earlier good one.
 */
export async function setCustomerIdentity(
  sessionId: string,
  identity: { name: string | null; avatarUrl: string | null },
): Promise<void> {
  if (!identity.name && !identity.avatarUrl) return;

  const client = createServiceClient();
  const { error } = await client
    .from('chat_sessions')
    .update({
      ...(identity.name ? { customer_name: identity.name } : {}),
      ...(identity.avatarUrl ? { customer_avatar_url: identity.avatarUrl } : {}),
    })
    .eq('id', sessionId);
  if (error) throw error;
}

/**
 * Per-session turn lease + supersession epoch (docs/23-MESSAGE-BATCHING.md §3).
 *
 * The lease is what stops two workers running a turn for the same customer at
 * once; the epoch is what lets a worker mid-LLM-call notice that a newer message
 * arrived. Both live behind SQL functions (migration 0039) rather than plain
 * updates because the claim MUST be a single atomic statement — a
 * read-then-write races two workers into the same session.
 */

/**
 * Try to take the turn lease. Returns true only if it was actually claimed;
 * false means another worker owns it and the caller must NOT run a turn.
 * `claim_session_turn` returns null (no row matched) rather than false when the
 * lease is held, hence the `=== true` check.
 */
export async function claimTurn(
  sessionId: string,
  leaseId: string,
  ttlSeconds: number,
): Promise<boolean> {
  const client = createServiceClient();
  const { data, error } = await client.rpc('claim_session_turn', {
    p_session_id: sessionId,
    p_lease_id: leaseId,
    p_ttl_seconds: ttlSeconds,
  });
  if (error) throw error;
  return data === true;
}

/**
 * Extend a lease we still hold — called on each supersession restart so a long
 * burst can't let the lease expire underneath its owner. A false return means we
 * no longer own it (it expired and someone else claimed it), which the caller
 * should treat as "stop, another worker has taken over".
 */
export async function renewTurn(
  sessionId: string,
  leaseId: string,
  ttlSeconds: number,
): Promise<boolean> {
  const client = createServiceClient();
  const { data, error } = await client.rpc('renew_session_turn', {
    p_session_id: sessionId,
    p_lease_id: leaseId,
    p_ttl_seconds: ttlSeconds,
  });
  if (error) throw error;
  return data === true;
}

/**
 * Release a lease we hold. Gated on ownership server-side, so a worker that
 * overran its TTL can never release the lease a DIFFERENT worker now holds.
 * Best-effort by design: a failure here just means the lease expires on its TTL
 * instead of immediately, which is exactly what the TTL is for — so callers log
 * rather than fail the turn (the reply has usually already been sent).
 */
export async function releaseTurn(sessionId: string, leaseId: string): Promise<void> {
  const client = createServiceClient();
  const { error } = await client.rpc('release_session_turn', {
    p_session_id: sessionId,
    p_lease_id: leaseId,
  });
  if (error) throw error;
}

/** Current supersession epoch for a session — the value a turn snapshots before calling the LLM. */
export async function readEpoch(sessionId: string): Promise<number> {
  const client = createServiceClient();
  const { data, error } = await client
    .from('chat_sessions')
    .select('inbound_epoch')
    .eq('id', sessionId)
    .single();
  if (error) throw error;
  return data.inbound_epoch;
}

/** Load a session by id, regardless of tenant — used by `continueSession` to resume a turn. */
export async function getById(sessionId: string): Promise<ChatSession | null> {
  const client = createServiceClient();
  const { data, error } = await client.from('chat_sessions').select('*').eq('id', sessionId).maybeSingle();

  if (error) throw error;
  return data ? mapSession(data) : null;
}
