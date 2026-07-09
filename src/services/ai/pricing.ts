import type { LlmUsage } from './provider';

/**
 * Per-model USD pricing per 1M tokens. Update as providers change prices.
 * Used to populate usage_logs.estimated_cost_usd (billing/cost/abuse signals).
 * See docs/05-AI-PIPELINE.md §7.
 */
const RATES: Record<string, { inputPerM: number; outputPerM: number }> = {
  // TODO(sonnet): verify current prices before relying on billing figures.
  'gpt-4o-mini': { inputPerM: 0.15, outputPerM: 0.6 },
  'gpt-4o': { inputPerM: 2.5, outputPerM: 10 },
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
