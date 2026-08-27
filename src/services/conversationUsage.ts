import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { CONVERSATION_SESSION_WINDOW_MS } from '@/lib/entitlements';
import { isNewBillableConversation, startOfUtcMonth } from '@/lib/conversation-metering';

export { isNewBillableConversation, startOfUtcMonth } from '@/lib/conversation-metering';

/**
 * Monthly billable-conversation metering.
 *
 * A billable conversation is one customer on one channel. If they go quiet for
 * 24h and message again, that counts as a new billable conversation.
 */

/** How many billable conversations this tenant has used in the current UTC month. */
export async function countConversationsThisMonth(tenantId: string, now = new Date()): Promise<number> {
  const client = createServiceClient();
  const { count, error } = await client
    .from('conversation_usage')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .gte('billed_at', startOfUtcMonth(now).toISOString());

  if (error) throw error;
  return count ?? 0;
}

/**
 * Timestamp of the most recent inbound customer message on this session
 * (before the message we're about to process). Null = no prior customer turn.
 */
export async function lastUserMessageAt(sessionId: string): Promise<string | null> {
  const client = createServiceClient();
  const { data, error } = await client
    .from('chat_messages')
    .select('created_at')
    .eq('session_id', sessionId)
    .eq('role', 'user')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.created_at ?? null;
}

/** True if this session already consumed a billable slot within the inactivity window. */
async function hasBillableInWindow(
  sessionId: string,
  now = new Date(),
  windowMs = CONVERSATION_SESSION_WINDOW_MS,
): Promise<boolean> {
  const client = createServiceClient();
  const since = new Date(now.getTime() - windowMs).toISOString();
  const { count, error } = await client
    .from('conversation_usage')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .gte('billed_at', since);

  if (error) throw error;
  return (count ?? 0) > 0;
}

/** Record one billable conversation for this tenant/session. */
export async function recordBillableConversation(tenantId: string, sessionId: string): Promise<void> {
  const client = createServiceClient();
  const { error } = await client.from('conversation_usage').insert({
    tenant_id: tenantId,
    session_id: sessionId,
  });
  if (error) throw error;
}

/**
 * Decide whether this turn may proceed under the monthly conversation cap.
 *
 * Continuations are only free if we already billed this session inside the 24h
 * window — so a capped deny that still persisted the customer message cannot
 * unlock free AI replies on the next inbound.
 */
export async function gateBillableConversation(args: {
  tenantId: string;
  sessionId: string;
  monthlyCap: number;
  now?: Date;
}): Promise<{ ok: true; billed: boolean } | { ok: false; used: number; cap: number }> {
  const now = args.now ?? new Date();
  const lastAt = await lastUserMessageAt(args.sessionId);
  const isNew = isNewBillableConversation(lastAt, now);

  if (!isNew) {
    if (await hasBillableInWindow(args.sessionId, now)) {
      return { ok: true, billed: false };
    }
    // In-window traffic after a capped deny (message saved, no billable row).
  }

  const used = await countConversationsThisMonth(args.tenantId, now);
  if (used >= args.monthlyCap) {
    return { ok: false, used, cap: args.monthlyCap };
  }

  await recordBillableConversation(args.tenantId, args.sessionId);
  return { ok: true, billed: true };
}
