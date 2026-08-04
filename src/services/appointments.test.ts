import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }));

import { resolveDayHint } from './appointments';

const KARACHI = 'Asia/Karachi';
// Tue 4 Aug 2026, 09:00 Karachi (= 04:00Z).
const NOW = new Date('2026-08-04T04:00:00Z');

describe('resolveDayHint', () => {
  it('resolves today and tomorrow in the tenant timezone', () => {
    expect(resolveDayHint('today', KARACHI, NOW)).toBe('2026-08-04');
    expect(resolveDayHint('tomorrow', KARACHI, NOW)).toBe('2026-08-05');
  });

  it('accepts an explicit ISO date', () => {
    expect(resolveDayHint('2026-08-09', KARACHI, NOW)).toBe('2026-08-09');
  });

  it('resolves a named weekday to the NEXT one, not today', () => {
    // NOW is a Tuesday; "tuesday" should mean next week's, not today's.
    expect(resolveDayHint('tuesday', KARACHI, NOW)).toBe('2026-08-11');
    expect(resolveDayHint('thursday', KARACHI, NOW)).toBe('2026-08-06');
  });

  it('accepts three-letter abbreviations', () => {
    expect(resolveDayHint('thu', KARACHI, NOW)).toBe('2026-08-06');
  });

  it('"next friday" skips a week past the coming friday', () => {
    expect(resolveDayHint('friday', KARACHI, NOW)).toBe('2026-08-07');
    expect(resolveDayHint('next friday', KARACHI, NOW)).toBe('2026-08-14');
  });

  it('returns null rather than guessing at something unreadable', () => {
    expect(resolveDayHint('sometime soon', KARACHI, NOW)).toBeNull();
    expect(resolveDayHint('', KARACHI, NOW)).toBeNull();
    expect(resolveDayHint('whenever', KARACHI, NOW)).toBeNull();
  });

  it('parses the day LABEL the model echoes back, not just the customer word', () => {
    // Verified against the real model 2026-08-04: given available_days of
    // ["Tue 4 Aug", ...], it called the tool with day="Thu 6 Aug" — the tool's
    // own label, not the customer's "thursday". Both must resolve.
    expect(resolveDayHint('Thu 6 Aug', KARACHI, NOW)).toBe('2026-08-06');
    expect(resolveDayHint('Wed 5 Aug', KARACHI, NOW)).toBe('2026-08-05');
  });

  it('uses the tenant timezone, so a late-UTC instant is the local day', () => {
    // 2026-08-04T20:00Z is already 5 Aug in Karachi (UTC+5).
    const late = new Date('2026-08-04T20:00:00Z');
    expect(resolveDayHint('today', KARACHI, late)).toBe('2026-08-05');
  });
});
