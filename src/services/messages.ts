import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import type { ChatMessage, MessageRole } from '@/types/domain';
import type { LlmUsage } from './ai/provider';

/**
 * Message persistence, short-term memory window, and usage metering.
 * Uses the SERVICE client from webhook/after() context. See docs/08 §5.3.
 */

export async function persist(args: {
  sessionId: string;
  tenantId: string;
  role: MessageRole;
  content: string;
  providerMsgId?: string;
  tokenCount?: number;
}): Promise<void> {
  void createServiceClient();
  void args;
  throw new Error('TODO(sonnet): implement persist (insert chat_messages)');
}

/**
 * Load the recent conversation window (chronological, oldest→newest), trimmed to
 * a token budget so the dynamic tail stays small. See docs/05-AI-PIPELINE.md §4.
 */
export async function loadWindow(
  sessionId: string,
  budgetTokens: number,
): Promise<Pick<ChatMessage, 'role' | 'content'>[]> {
  void createServiceClient();
  void sessionId;
  void budgetTokens;
  throw new Error('TODO(sonnet): implement loadWindow (select recent chat_messages)');
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
  void createServiceClient();
  void args;
  throw new Error('TODO(sonnet): implement logUsage (insert usage_logs)');
}
