import type { LlmContentPart, LlmMessage, LlmUsage } from './provider';

/**
 * Per-model USD pricing per 1M tokens. Update as providers change prices.
 * Used to populate usage_logs.estimated_cost_usd (billing/cost/abuse signals).
 * See docs/05-AI-PIPELINE.md §7.
 */
const RATES: Record<string, { inputPerM: number; outputPerM: number }> = {
  // TODO(sonnet): verify current prices before relying on billing figures.
  'gpt-4o-mini': { inputPerM: 0.15, outputPerM: 0.6 },
  'gpt-4o': { inputPerM: 2.5, outputPerM: 10 },
  'text-embedding-3-small': { inputPerM: 0.02, outputPerM: 0 },
};

export function estimateCostUsd(usage: LlmUsage, model: string): number {
  const rate = RATES[model];
  if (!rate) return 0;
  const cost =
    (usage.promptTokens / 1_000_000) * rate.inputPerM +
    (usage.completionTokens / 1_000_000) * rate.outputPerM;
  // 6 dp to match usage_logs.estimated_cost_usd numeric(10,6)
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/** Same crude chars-per-token ratio services/messages.ts uses for the memory window. */
const CHARS_PER_TOKEN_ESTIMATE = 4;

/**
 * Approximate prompt tokens for a call that was ABORTED before the provider
 * returned a usage object (docs/23-MESSAGE-BATCHING.md §5.4).
 *
 * The input side of an aborted call is still real spend — the provider bills it
 * on accepting the request, whether or not we hang up — and unlike the
 * completion side it is derivable, because we built the prompt ourselves. This
 * is a character-ratio approximation, not a tokenizer: it exists so a superseded
 * turn contributes its dominant cost to the cap instead of contributing nothing.
 *
 * Image parts are deliberately NOT counted. Vision token cost depends on
 * resolution and provider-specific tiling, so any number here would be invented;
 * omitting it under-counts a vision turn rather than fabricating a figure.
 */
export function estimatePromptTokens(messages: LlmMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += contentChars(m.content);
    for (const tc of m.toolCalls ?? []) chars += tc.name.length + tc.arguments.length;
  }
  return Math.ceil(chars / CHARS_PER_TOKEN_ESTIMATE);
}

function contentChars(content: string | LlmContentPart[]): number {
  if (typeof content === 'string') return content.length;
  return content.reduce((sum, p) => sum + (p.type === 'text' ? p.text.length : 0), 0);
}
