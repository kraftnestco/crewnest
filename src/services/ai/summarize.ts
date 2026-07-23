import 'server-only';
import { getProvider } from './provider';
import type { LlmMessage } from './provider';
import { getLlmKey } from '@/lib/secrets';
import { SUMMARY_MODEL_BY_PROVIDER, SUMMARY_TOKEN_CAP } from '@/lib/constants';
import type { ChatMessage, Tenant } from '@/types/domain';
import { log } from '@/lib/log';

const SUMMARIZER_SYSTEM_PROMPT =
  'Summarise the older part of a customer-support conversation into a short running digest for an ' +
  'AI assistant to keep as memory. Keep names, agreed order/design details, prices, and open ' +
  `commitments. Drop small talk and resolved back-and-forth. Plain prose, no headers or bullet ` +
  `points, at most ~${SUMMARY_TOKEN_CAP} tokens.`;

/**
 * Folds newly-dropped-from-window messages into the running rolling summary
 * (docs/18 §2, Stage U-mem). Deliberately uses a FIXED cheap model for the tenant's
 * provider (`SUMMARY_MODEL_BY_PROVIDER`), not `tenant.llmModel` — this runs on every
 * truncated turn in the background, so it should stay cheap even for a tenant who
 * has overridden their main model to something pricier. Returns '' (never throws
 * for a degenerate model response) on an empty completion; callers treat that as
 * "nothing to store" rather than clobbering the existing summary.
 */
export async function refreshSummary(
  tenant: Pick<Tenant, 'llmProvider' | 'openaiKeySecretId'>,
  previousSummary: string | null,
  newMessages: Pick<ChatMessage, 'role' | 'content'>[],
): Promise<string> {
  const model = SUMMARY_MODEL_BY_PROVIDER[tenant.llmProvider];
  if (!model) {
    log.warn('[summarize] no cheap summary model configured for provider', { provider: tenant.llmProvider });
    return '';
  }

  const provider = getProvider(tenant.llmProvider);
  const { key } = await getLlmKey(tenant);

  const transcript = newMessages.map((m) => `${m.role}: ${m.content}`).join('\n');
  const userContent = previousSummary
    ? `Existing summary so far:\n${previousSummary}\n\nNew messages to fold in:\n${transcript}`
    : `Conversation so far:\n${transcript}`;

  const messages: LlmMessage[] = [
    { role: 'system', content: SUMMARIZER_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  const result = await provider.chat({ model, messages, temperature: 0, maxTokens: 400 }, key);
  return result.text?.trim() ?? '';
}
