import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import type { Json } from '@/types/database';
import type { ChatMessage, MessageRole, OrderAttachment } from '@/types/domain';
import type { LlmUsage } from './ai/provider';

/**
 * Message persistence, short-term memory window, and usage metering.
 * Uses the SERVICE client from webhook/after() context. See docs/08 §5.3.
 */

/** Crude chars-per-token estimate for trimming the memory window without a tokenizer. */
const CHARS_PER_TOKEN_ESTIMATE = 4;
/** Hard cap on rows fetched before applying the token budget, to bound query size. */
const WINDOW_FETCH_LIMIT = 50;

export async function persist(args: {
  sessionId: string;
  tenantId: string;
  role: MessageRole;
  content: string;
  attachments?: OrderAttachment[] | null;
  providerMsgId?: string;
  tokenCount?: number;
}): Promise<void> {
  const client = createServiceClient();
  const { error } = await client.from('chat_messages').insert({
    session_id: args.sessionId,
    tenant_id: args.tenantId,
    role: args.role,
    content: args.content,
    attachments: (args.attachments ?? null) as unknown as Json,
    provider_msg_id: args.providerMsgId ?? null,
    token_count: args.tokenCount ?? null,
  });

  if (error) throw error;
}

/**
 * Load the recent conversation window (chronological, oldest→newest), trimmed to
 * a token budget so the dynamic tail stays small. See docs/05-AI-PIPELINE.md §4.
 */
export async function loadWindow(
  sessionId: string,
  budgetTokens: number,
): Promise<Pick<ChatMessage, 'role' | 'content'>[]> {
  const client = createServiceClient();
  const { data, error } = await client
    .from('chat_messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(WINDOW_FETCH_LIMIT);

  if (error) throw error;

  const selected: Pick<ChatMessage, 'role' | 'content'>[] = [];
  let usedTokens = 0;

  for (const row of data ?? []) {
    const approxTokens = Math.ceil(row.content.length / CHARS_PER_TOKEN_ESTIMATE);
    if (selected.length > 0 && usedTokens + approxTokens > budgetTokens) break;
    selected.push({ role: row.role, content: row.content });
    usedTokens += approxTokens;
  }

  return selected.reverse();
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

/** Write a per-turn usage row for billing/cost/abuse. */
export async function logUsage(args: {
  tenantId: string;
  sessionId: string | null;
  provider: string;
  model: string;
  usage: LlmUsage;
  usedByok: boolean;
  costUsd: number;
}): Promise<void> {
  const client = createServiceClient();
  const { error } = await client.from('usage_logs').insert({
    tenant_id: args.tenantId,
    session_id: args.sessionId,
    provider: args.provider,
    model: args.model,
    prompt_tokens: args.usage.promptTokens,
    completion_tokens: args.usage.completionTokens,
    total_tokens: args.usage.totalTokens,
    estimated_cost_usd: args.costUsd,
    used_byok: args.usedByok,
  });

  if (error) throw error;
}
