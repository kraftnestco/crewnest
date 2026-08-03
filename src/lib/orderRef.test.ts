import { describe, expect, it } from 'vitest';
import { businessPrefix, orderRef } from './orderRef';

describe('businessPrefix', () => {
  it('uses the initials of the first two words', () => {
    expect(businessPrefix('KraftNest Automations')).toBe('KN');
    expect(businessPrefix('Demo Cafe')).toBe('DC');
  });

  it('uses the first two letters of a single-word name', () => {
    expect(businessPrefix('Sheru')).toBe('SH');
  });

  it('pads a one-letter name rather than returning a single character', () => {
    expect(businessPrefix('K')).toBe('KX');
  });

  it('strips punctuation and digits so they cannot reach the prefix', () => {
    expect(businessPrefix("Ali's 24/7 Store")).toBe('AS');
    expect(businessPrefix('7-Eleven')).toBe('EL');
  });

  it('falls back to OR when a name yields no letters', () => {
    expect(businessPrefix('123 456')).toBe('OR');
    expect(businessPrefix('')).toBe('OR');
    expect(businessPrefix(null)).toBe('OR');
  });
});

describe('orderRef', () => {
  it('formats as PREFIX-MMDD-N', () => {
    expect(
      orderRef({
        businessName: 'KraftNest Automations',
        number: 5,
        createdAt: '2026-08-03T12:00:00Z',
        timezone: 'Asia/Karachi',
      }),
    ).toBe('KN-0803-5');
  });

  it('uses the TENANT timezone for the date, not UTC', () => {
    // 2026-08-03T20:00Z is already 4 Aug in Karachi (UTC+5).
    expect(
      orderRef({
        businessName: 'KraftNest Automations',
        number: 9,
        createdAt: '2026-08-03T20:00:00Z',
        timezone: 'Asia/Karachi',
      }),
    ).toBe('KN-0804-9');
  });

  it('falls back to UTC when no timezone is configured', () => {
    expect(
      orderRef({ businessName: 'Sheru', number: 2, createdAt: '2026-01-09T23:00:00Z', timezone: null }),
    ).toBe('SH-0109-2');
  });

  it('survives an invalid timezone string instead of throwing', () => {
    expect(
      orderRef({ businessName: 'Sheru', number: 2, createdAt: '2026-01-09T10:00:00Z', timezone: 'Not/AZone' }),
    ).toBe('SH-0109-2');
  });

  it('returns null when there is no sequential number', () => {
    expect(
      orderRef({ businessName: 'KraftNest Automations', number: null, createdAt: '2026-08-03T12:00:00Z' }),
    ).toBeNull();
  });
});
