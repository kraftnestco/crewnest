import { describe, expect, it } from 'vitest';
import { estimateCostUsd } from './pricing';
import type { LlmUsage } from './provider';

function usage(promptTokens: number, completionTokens: number): LlmUsage {
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}

describe('estimateCostUsd', () => {
  it('prices gpt-4o-mini from its input/output rates', () => {
    const cost = estimateCostUsd(usage(1_000_000, 1_000_000), 'gpt-4o-mini');
    expect(cost).toBeCloseTo(0.15 + 0.6, 6);
  });

  it('prices gpt-4o from its input/output rates', () => {
    const cost = estimateCostUsd(usage(1_000_000, 1_000_000), 'gpt-4o');
    expect(cost).toBeCloseTo(2.5 + 10, 6);
  });

  it('prices text-embedding-3-small with zero output cost', () => {
    const cost = estimateCostUsd(usage(1_000_000, 500_000), 'text-embedding-3-small');
    expect(cost).toBeCloseTo(0.02, 6);
  });

  it('returns 0 for an unknown model', () => {
    expect(estimateCostUsd(usage(1000, 1000), 'made-up-model')).toBe(0);
  });

  it('rounds to 6 decimal places', () => {
    const cost = estimateCostUsd(usage(123, 456), 'gpt-4o-mini');
    expect(cost).toBe(Math.round(cost * 1_000_000) / 1_000_000);
  });

  it('returns 0 for zero usage', () => {
    expect(estimateCostUsd(usage(0, 0), 'gpt-4o-mini')).toBe(0);
  });
});
