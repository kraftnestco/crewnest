import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { SUMMARY_SOURCE_FETCH_LIMIT } from '@/lib/constants';
import type { Json } from '@/types/database';
import type { AuthoredBy, ChatMessage, MessageRole, OrderAttachment } from '@/types/domain';
import type { LlmUsage } from './ai/provider';

/**
 * Message persistence, short-term memory window, and usage metering.
 * Uses the SERVICE client from webhook/after() context. See docs/08 §5.3.
 */

/** Crude chars-per-token estimate for trimming the memory window without a tokenizer. */
const CHARS_PER_TOKEN_ESTIMATE = 4;
/** Hard cap on rows fetched before applying the token budget, to bound query size. */
const WINDOW_FETCH_LIMIT = 50;

/** Returns the inserted row's id — needed by callers that may have to mark this exact message `delivery_failed` after a later dispatch failure (docs/15-RELIABILITY-AND-DURABILITY.md §6). */
export async function persist(args: {
  sessionId: string;
  tenantId: string;
  role: MessageRole;
  content: string;
  attachments?: OrderAttachment[] | null;
  providerMsgId?: string;
  tokenCount?: number;
  /** Who produced this reply (docs/16 §2.1) — defaults to 'ai', the correct assumption for an LLM turn. */
  authoredBy?: AuthoredBy;
  /**
   * Bump the session's supersession epoch as part of this write
   * (docs/23-MESSAGE-BATCHING.md §4 phase 1). Set for INBOUND CUSTOMER messages
   * only: the epoch means "new customer input has arrived", so bumping it for
   * our own assistant/system rows would spuriously supersede a live turn.
   */
  bumpEpoch?: boolean;
}): Promise<string> {
  const client = createServiceClient();
  const { data, error } = await client
    .from('chat_messages')
    .insert({
      session_id: args.sessionId,
      tenant_id: args.tenantId,
      role: args.role,
      content: args.content,
      attachments: (args.attachments ?? null) as unknown as Json,
      provider_msg_id: args.providerMsgId ?? null,
      token_count: args.tokenCount ?? null,
      authored_by: args.authoredBy ?? 'ai',
    })
    .select('id')
    .single();

  if (error) {
    // 23505 = the partial unique index on provider_msg_id (migration 0043).
    // Two retries raced and both passed the check above; the index is what
    // actually prevents the duplicate. Re-read rather than throwing — the
    // message IS stored, which is all the caller needs to be true. Returns
    // early so the epoch is not bumped twice for one customer message.
    if (error.code === '23505' && args.providerMsgId) {
      const { data: raced } = await client
        .from('chat_messages')
        .select('id')
        .eq('provider_msg_id', args.providerMsgId)
        .maybeSingle();
      if (raced) return raced.id;
    }
    throw error;
  }

  if (args.bumpEpoch) {
    // Deliberately AFTER the insert and not swallowed: a message that is
    // persisted but whose epoch never moved is invisible to the supersession
    // check — i.e. silently unanswered, the one failure this feature must not
    // have. Failing loudly means the queue retries the whole message instead.
    const { error: epochError } = await client.rpc('bump_inbound_epoch', {
      p_session_id: args.sessionId,
    });
    if (epochError) throw epochError;
  }

  return data.id;
}

/**
 * Every user message newer than the most recent assistant reply, chronological
 * (docs/23-MESSAGE-BATCHING.md §6) — the burst a single turn should answer.
 *
 * Returns them as separate strings; the caller joins them into ONE user turn
 * rather than N consecutive user turns (some providers reject consecutive
 * same-role messages, and one coherent turn is closer to how a person reads a
 * burst anyway).
 */
export async function loadPendingUserMessages(sessionId: string): Promise<string[]> {
  const client = createServiceClient();

  const { data: lastAssistant, error: assistantError } = await client
    .from('chat_messages')
    .select('created_at')
    .eq('session_id', sessionId)
    .eq('role', 'assistant')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (assistantError) throw assistantError;

  let query = client
    .from('chat_messages')
    .select('content, created_at')
    .eq('session_id', sessionId)
    .eq('role', 'user')
    .order('created_at', { ascending: true })
    .limit(WINDOW_FETCH_LIMIT);

  if (lastAssistant) query = query.gt('created_at', lastAssistant.created_at);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((r) => r.content);
}

/** Mark a specific message as failed to deliver (docs/15 §6) — reuses migration 0022's delivery_failed column, so the inbox already renders the "not delivered" state with no UI change needed. */
export async function markDeliveryFailed(messageId: string): Promise<void> {
  const client = createServiceClient();
  const { error } = await client.from('chat_messages').update({ delivery_failed: true }).eq('id', messageId);
  if (error) throw error;
}

export interface WindowResult {
  /** Chronological (oldest→newest), same shape `loadWindow` always returned. */
  messages: Pick<ChatMessage, 'role' | 'content'>[];
  /**
   * True when older messages existed beyond what fit in this window — either the
   * fetch limit or the token budget cut them off (docs/18 §2, Stage U-mem: this is
   * the "loadWindow had to drop rows" signal that gates a summary refresh).
   */
  truncated: boolean;
  /** `created_at` of the oldest message actually kept, or null if the session has no messages yet. */
  oldestKeptAt: string | null;
}

/**
 * Load the recent conversation window (chronological, oldest→newest), trimmed to
 * a token budget so the dynamic tail stays small. See docs/05-AI-PIPELINE.md §4.
 */
export async function loadWindow(sessionId: string, budgetTokens: number): Promise<WindowResult> {
  const client = createServiceClient();
  // Fetch one row past the limit purely to detect "more exist beyond the fetch
  // limit" without a separate count query; that extra row is never selected below.
  const { data, error } = await client
    .from('chat_messages')
    .select('role, content, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(WINDOW_FETCH_LIMIT + 1);

  if (error) throw error;

  const rows = data ?? [];
  const moreThanFetchLimit = rows.length > WINDOW_FETCH_LIMIT;
  const candidates = moreThanFetchLimit ? rows.slice(0, WINDOW_FETCH_LIMIT) : rows;

  const selected: Pick<ChatMessage, 'role' | 'content'>[] = [];
  let usedTokens = 0;
  let oldestKeptAt: string | null = null;

  for (const row of candidates) {
    const approxTokens = Math.ceil(row.content.length / CHARS_PER_TOKEN_ESTIMATE);
    if (selected.length > 0 && usedTokens + approxTokens > budgetTokens) break;
    selected.push({ role: row.role, content: row.content });
    usedTokens += approxTokens;
    oldestKeptAt = row.created_at;
  }

  return {
    messages: selected.reverse(),
    truncated: moreThanFetchLimit || selected.length < candidates.length,
    oldestKeptAt,
  };
}

/**
 * The slice of history a rolling-summary refresh needs (docs/18 §2, Stage U-mem):
 * everything older than the live window's oldest kept message, and newer than
 * whatever the summary already covers. Ascending (oldest first) so it reads like a
 * transcript. Capped by `SUMMARY_SOURCE_FETCH_LIMIT` so one huge one-time backlog
 * (e.g. the very first truncation on an imported/long-idle session) can't blow up a
 * single refresh call — it catches up over a few turns instead.
 */
export async function loadMessagesForSummary(
  sessionId: string,
  windowOldestAt: string,
  summarizedThroughAt: string | null,
): Promise<{ messages: Pick<ChatMessage, 'role' | 'content'>[]; newestIncludedAt: string | null }> {
  const client = createServiceClient();
  let query = client
    .from('chat_messages')
    .select('role, content, created_at')
    .eq('session_id', sessionId)
    .lt('created_at', windowOldestAt)
    .order('created_at', { ascending: true })
    .limit(SUMMARY_SOURCE_FETCH_LIMIT);

  if (summarizedThroughAt) {
    query = query.gt('created_at', summarizedThroughAt);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = data ?? [];
  return {
    messages: rows.map((r) => ({ role: r.role, content: r.content })),
    newestIncludedAt: rows.length ? rows[rows.length - 1].created_at : null,
  };
}

/** Abuse cap: how many media attachments this session has had processed within the window (docs/10 §4.4/§8). */
export async function countRecentAttachments(sessionId: string, windowMinutes: number): Promise<number> {
  const client = createServiceClient();
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const { data, error } = await client
    .from('chat_messages')
    .select('attachments')
    .eq('session_id', sessionId)
    .not('attachments', 'is', null)
    .gte('created_at', since);

  if (error) throw error;
  return (data ?? []).reduce(
    (sum, row) => sum + (Array.isArray(row.attachments) ? row.attachments.length : 0),
    0,
  );
}

/**
 * Storage path of the most recent image attachment in this session within the window,
 * or null. Backs cross-turn image memory (mediaIntake.getRecentImageUrl): images ride
 * only the turn they arrive on, so a later "the picture I sent you" needs the prior
 * image re-attached. Scans the newest few attachment-bearing rows and returns the first
 * image found (most recent wins).
 */
export async function getRecentImageStoragePath(
  sessionId: string,
  windowMinutes: number,
): Promise<string | null> {
  const client = createServiceClient();
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const { data, error } = await client
    .from('chat_messages')
    .select('attachments')
    .eq('session_id', sessionId)
    .not('attachments', 'is', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) throw error;

  for (const row of data ?? []) {
    const atts = (Array.isArray(row.attachments) ? row.attachments : []) as unknown as OrderAttachment[];
    const img = atts.find((a) => a?.kind === 'image' && Boolean(a?.storagePath));
    if (img) return img.storagePath;
  }
  return null;
}

/**
 * Trailing-30-day master-key spend for a tenant (docs/18 §3, Stage U-cap) — sums
 * `estimated_cost_usd` from `usage_logs` over the last 30 days (rolling, not
 * calendar-month), master-key rows only (`used_byok=false`; a BYOK tenant spends
 * their own key, never counted toward the platform's free-plan ceiling). Rolling
 * so a capped tenant un-sticks automatically as old spend ages out, with no
 * monthly-rollover job needed. Reads the existing `usage_logs_period_idx
 * (tenant_id, created_at)` index (migration 0004).
 */
export async function getTrailing30DayMasterCostUsd(tenantId: string): Promise<number> {
  const client = createServiceClient();
  const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const { data, error } = await client
    .from('usage_logs')
    .select('estimated_cost_usd')
    .eq('tenant_id', tenantId)
    .eq('used_byok', false)
    .gte('created_at', windowStart.toISOString());

  if (error) throw error;
  return (data ?? []).reduce((sum, row) => sum + row.estimated_cost_usd, 0);
}

/**
 * Write a per-turn usage row for billing/cost/abuse.
 *
 * Calls that RETURN carry the provider's own `usage` object and are logged
 * exactly as they always have been — that is the overwhelming majority of rows.
 *
 * `superseded` rows (docs/23-MESSAGE-BATCHING.md §5.4) are the exception: a call
 * we aborted mid-flight has no provider usage, so its prompt tokens are computed
 * from the prompt we built (exact — the provider bills input on accepting the
 * request regardless of us hanging up) while its completion tokens are genuinely
 * unknown and stored as NULL, never 0. Recording the unknown as zero would be a
 * quiet lie in a billing-adjacent table; NULL + the marker keeps it measurable.
 */
export async function logUsage(args: {
  tenantId: string;
  sessionId: string | null;
  provider: string;
  model: string;
  usage: LlmUsage;
  usedByok: boolean;
  costUsd: number;
  /** True only for a call aborted by supersession — see above. */
  superseded?: boolean;
}): Promise<void> {
  const client = createServiceClient();
  const { error } = await client.from('usage_logs').insert({
    tenant_id: args.tenantId,
    session_id: args.sessionId,
    provider: args.provider,
    model: args.model,
    prompt_tokens: args.usage.promptTokens,
    completion_tokens: args.superseded ? null : args.usage.completionTokens,
    total_tokens: args.usage.totalTokens,
    estimated_cost_usd: args.costUsd,
    used_byok: args.usedByok,
    superseded: args.superseded ?? false,
  });

  if (error) throw error;
}
