import { describe, expect, it } from 'vitest';
import { build, type BuildArgs } from './promptBuilder';
import type { Tenant } from '@/types/domain';

const TENANT: BuildArgs['tenant'] = {
  id: 'tenant-1',
  systemPrompt: 'You are the assistant for Acme Co.',
  catalogData: { items: [{ name: 'Widget', price: 10 }] },
  ordersEnabled: true,
  customOrdersEnabled: false,
  customOrderInstructions: null,
  mediaHandling: 'match_catalogue' as Tenant['mediaHandling'],
  customOrdersRequireApproval: false,
  businessType: 'product' as Tenant['businessType'],
  bookingLink: null,
  knowledgeBase: { location: '123 Main St' },
  businessHours: null,
  paymentsEnabled: false,
  paymentMethods: [],
  paymentInstructions: null,
};

describe('promptBuilder.build cache-prefix byte-identity', () => {
  it('keeps messages[0] byte-identical across turns with different history/userText/pendingReview', () => {
    const first = build({
      tenant: TENANT,
      history: [{ role: 'user', content: 'hi' }],
      userText: 'do you have this in blue?',
    });
    const second = build({
      tenant: TENANT,
      history: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hey, what can I help with?' },
        { role: 'user', content: 'I want to order 3 widgets' },
      ],
      userText: 'actually make that 5',
      pendingReview: { orderId: 'ord_1', itemsSummary: '5x Widget' },
    });

    expect(first.messages[0].content).toBe(second.messages[0].content);
  });

  it('always reports cachePrefixLength 1', () => {
    const result = build({ tenant: TENANT, history: [], userText: 'hello' });
    expect(result.cachePrefixLength).toBe(1);
  });

  it('never leaks dynamic content (history, pendingReview, userText) into the static prefix', () => {
    const result = build({
      tenant: TENANT,
      history: [{ role: 'user', content: 'UNIQUE_HISTORY_MARKER' }],
      userText: 'UNIQUE_USER_TEXT_MARKER',
      pendingReview: { orderId: 'ord_2', itemsSummary: 'UNIQUE_REVIEW_MARKER' },
    });
    const prefix = result.messages[0].content as string;
    expect(prefix).not.toContain('UNIQUE_HISTORY_MARKER');
    expect(prefix).not.toContain('UNIQUE_USER_TEXT_MARKER');
    expect(prefix).not.toContain('UNIQUE_REVIEW_MARKER');

    const rest = result.messages.slice(result.cachePrefixLength);
    const restText = rest.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
    expect(restText).toContain('UNIQUE_HISTORY_MARKER');
    expect(restText).toContain('UNIQUE_USER_TEXT_MARKER');
    expect(restText).toContain('UNIQUE_REVIEW_MARKER');
  });

  it('omits the trailing user message for a continuation turn (userText: null)', () => {
    const history: BuildArgs['history'] = [
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'Staff answered: it ships in blue.' },
    ];
    const result = build({ tenant: TENANT, history, userText: null });
    const last = result.messages[result.messages.length - 1];
    expect(last.role).toBe('system');
    expect(last.content).toBe('Staff answered: it ships in blue.');
    // No message beyond the static prefix + history itself — no new trailing user turn was appended.
    expect(result.messages.length).toBe(1 + history.length);
  });

  it('includes a pendingReview system block between history and the new user message', () => {
    const result = build({
      tenant: TENANT,
      history: [{ role: 'user', content: 'hi' }],
      userText: 'thanks!',
      pendingReview: { orderId: 'ord_3', itemsSummary: '1x Widget' },
    });
    const last = result.messages[result.messages.length - 1];
    const secondToLast = result.messages[result.messages.length - 2];
    expect(last).toEqual({ role: 'user', content: 'thanks!' });
    expect(secondToLast.role).toBe('system');
    expect(secondToLast.content).toContain('ord_3');
  });

  it('builds a multi-part user message when imageUrls are present', () => {
    const result = build({
      tenant: TENANT,
      history: [],
      userText: 'what is this?',
      imageUrls: ['https://example.com/signed-url.jpg'],
    });
    const last = result.messages[result.messages.length - 1];
    expect(Array.isArray(last.content)).toBe(true);
    const parts = last.content as Array<{ type: string }>;
    expect(parts[0]).toEqual({ type: 'text', text: 'what is this?' });
    expect(parts[1]).toEqual({ type: 'image_url', imageUrl: 'https://example.com/signed-url.jpg' });
  });
});
