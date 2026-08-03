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
  bookingEnabled: false,
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
      pendingReview: { orderRef: 'KN-0803-1', itemsSummary: '5x Widget' },
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
      pendingReview: { orderRef: 'KN-0803-2', itemsSummary: 'UNIQUE_REVIEW_MARKER' },
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
      pendingReview: { orderRef: 'KN-0803-3', itemsSummary: '1x Widget' },
    });
    const last = result.messages[result.messages.length - 1];
    const secondToLast = result.messages[result.messages.length - 2];
    expect(last).toEqual({ role: 'user', content: 'thanks!' });
    expect(secondToLast.role).toBe('system');
    expect(secondToLast.content).toContain('KN-0803-3');
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

/**
 * docs/24 — booking guidance gating. Every one of these failed live on
 * 2026-08-03: the tenant had booking on, the tools were correctly advertised,
 * and the AI still told customers "we don't have online call booking set up
 * yet" — because that sentence was literally in the prompt as a GOOD example,
 * and the booking guidance was gated on `ordersEnabled` so it never rendered.
 */
describe('booking prompt gating', () => {
  const base = {
    id: 't',
    systemPrompt: 'Assistant.',
    catalogData: {},
    catalogFreeformText: null,
    customOrdersRequireApproval: true,
    customOrderInstructions: null,
    mediaHandling: 'match_catalogue',
    voiceHandling: 'human_review',
    csatPromptEnabled: false,
    knowledgeBase: null,
    businessHours: null,
    timezone: 'Asia/Karachi',
    paymentsEnabled: false,
    paymentMethods: [],
    paymentInstructions: null,
    bookingLink: null,
    ordersEnabled: false,
    customOrdersEnabled: false,
  } as unknown as BuildArgs['tenant'];

  const textOf = (t: Record<string, unknown>) =>
    build({ tenant: { ...base, ...t } as BuildArgs['tenant'], history: [], userText: 'x' })
      .messages.map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n');

  it('renders booking guidance with orders OFF — the case that shipped broken', () => {
    expect(textOf({ businessType: 'service', bookingEnabled: true })).toContain('## APPOINTMENT BOOKING');
  });

  it('drops the "we cannot schedule anything" denial when real booking is on', () => {
    const text = textOf({ businessType: 'service', bookingEnabled: true });
    expect(text).not.toContain('no way to actually schedule a call');
    expect(text).not.toContain("We don't have online call booking set up yet");
  });

  it('keeps that denial for a tenant WITHOUT real booking', () => {
    const text = textOf({ businessType: 'service', bookingEnabled: false });
    expect(text).toContain('no way to actually schedule a call');
    expect(text).not.toContain('## APPOINTMENT BOOKING');
  });

  it('never gives booking guidance to a product business', () => {
    expect(textOf({ businessType: 'product', bookingEnabled: true, ordersEnabled: true })).not.toContain(
      '## APPOINTMENT BOOKING',
    );
  });

  it('renders booking AND the service flow when orders are on too', () => {
    const text = textOf({ businessType: 'service', bookingEnabled: true, ordersEnabled: true });
    expect(text).toContain('## APPOINTMENT BOOKING');
    expect(text).toContain('SERVICE FLOW');
  });
});
