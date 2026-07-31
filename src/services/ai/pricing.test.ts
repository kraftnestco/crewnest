import { describe, expect, it } from 'vitest';
import { estimateCostUsd, estimatePromptTokens } from './pricing';
import type { LlmMessage, LlmUsage } from './provider';

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

/**
 * docs/23-MESSAGE-BATCHING.md §5.4 — the input side of a call we aborted before
 * the provider returned usage. Only reached for superseded turns; every call that
 * RETURNS is still metered from the provider's own numbers.
 */
describe('estimatePromptTokens', () => {
  it('counts plain string content at the chars-per-token ratio', () => {
    const msgs: LlmMessage[] = [{ role: 'user', content: 'a'.repeat(400) }];
    expect(estimatePromptTokens(msgs)).toBe(100);
  });

  it('sums across every message in the conversation', () => {
    const msgs: LlmMessage[] = [
      { role: 'system', content: 'a'.repeat(40) },
      { role: 'user', content: 'b'.repeat(40) },
      { role: 'assistant', content: 'c'.repeat(40) },
    ];
    expect(estimatePromptTokens(msgs)).toBe(30);
  });

  it('counts the text parts of a multimodal user turn', () => {
    const msgs: LlmMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'a'.repeat(80) }] },
    ];
    expect(estimatePromptTokens(msgs)).toBe(20);
  });

  it('ignores image parts rather than inventing a vision-token figure', () => {
    const withImage: LlmMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'a'.repeat(80) },
          { type: 'image_url', imageUrl: 'https://example.com/a-very-long-signed-url-'.repeat(20) },
        ],
      },
    ];
    const textOnly: LlmMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'a'.repeat(80) }] },
    ];
    expect(estimatePromptTokens(withImage)).toBe(estimatePromptTokens(textOnly));
  });

  it('counts tool-call names and arguments (they are real prompt input)', () => {
    const msgs: LlmMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'ab', arguments: '{"x":1}' }],
      },
    ];
    // 'ab' (2) + '{"x":1}' (7) = 9 chars ⇒ ceil(9/4) = 3
    expect(estimatePromptTokens(msgs)).toBe(3);
  });

  it('returns 0 for an empty conversation', () => {
    expect(estimatePromptTokens([])).toBe(0);
  });

  it('never returns a fractional token count', () => {
    const msgs: LlmMessage[] = [{ role: 'user', content: 'abcde' }];
    expect(Number.isInteger(estimatePromptTokens(msgs))).toBe(true);
  });
});
