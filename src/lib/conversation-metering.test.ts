import { describe, it, expect } from 'vitest';
import { isNewBillableConversation, startOfUtcMonth } from '@/lib/conversation-metering';
import { CONVERSATION_SESSION_WINDOW_MS } from '@/lib/entitlements';

describe('isNewBillableConversation — 24h inactivity window', () => {
  const now = new Date('2026-08-26T12:00:00.000Z');

  it('counts the first message as a new conversation', () => {
    expect(isNewBillableConversation(null, now)).toBe(true);
  });

  it('does not re-count within the 24h window', () => {
    const recent = new Date(now.getTime() - CONVERSATION_SESSION_WINDOW_MS + 60_000).toISOString();
    expect(isNewBillableConversation(recent, now)).toBe(false);
  });

  it('counts again after 24h of silence', () => {
    const old = new Date(now.getTime() - CONVERSATION_SESSION_WINDOW_MS).toISOString();
    expect(isNewBillableConversation(old, now)).toBe(true);
  });
});

describe('startOfUtcMonth', () => {
  it('returns the UTC month boundary', () => {
    const start = startOfUtcMonth(new Date('2026-08-26T15:30:00.000Z'));
    expect(start.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });
});
