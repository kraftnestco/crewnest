import { describe, expect, it } from 'vitest';
import { computeOpenNow } from './hours';

const KARACHI = 'Asia/Karachi'; // UTC+5, no DST — safe for fixed-offset arithmetic below.

function hours(week: { day: string; open: string; close: string }[]) {
  return { week };
}

describe('computeOpenNow', () => {
  it('reports open during business hours (Karachi, same-day range)', () => {
    // 2024-01-03T05:00:00Z = Wed 10:00 in Karachi (UTC+5).
    const now = new Date('2024-01-03T05:00:00Z');
    const result = computeOpenNow(hours([{ day: 'Wed', open: '09:00', close: '18:00' }]), KARACHI, now);
    expect(result).toEqual({ isOpen: true, localTimeLabel: 'Wednesday 10:00' });
  });

  it('reports closed outside business hours (Karachi, same-day range)', () => {
    // 2024-01-03T15:00:00Z = Wed 20:00 in Karachi.
    const now = new Date('2024-01-03T15:00:00Z');
    const result = computeOpenNow(hours([{ day: 'Wed', open: '09:00', close: '18:00' }]), KARACHI, now);
    expect(result).toEqual({ isOpen: false, localTimeLabel: 'Wednesday 20:00' });
  });

  it('returns null when timezone is missing', () => {
    expect(computeOpenNow(hours([{ day: 'Wed', open: '09:00', close: '18:00' }]), null)).toBeNull();
    expect(computeOpenNow(hours([{ day: 'Wed', open: '09:00', close: '18:00' }]), undefined)).toBeNull();
  });

  it('returns null when business hours are not configured', () => {
    expect(computeOpenNow(undefined, KARACHI)).toBeNull();
    expect(computeOpenNow({}, KARACHI)).toBeNull();
    expect(computeOpenNow(hours([]), KARACHI)).toBeNull();
  });

  it('returns null (not throw) for an invalid IANA timezone string', () => {
    const now = new Date('2024-01-03T05:00:00Z');
    expect(() =>
      computeOpenNow(hours([{ day: 'Wed', open: '09:00', close: '18:00' }]), 'Not/ARealZone', now),
    ).not.toThrow();
    expect(computeOpenNow(hours([{ day: 'Wed', open: '09:00', close: '18:00' }]), 'Not/ARealZone', now)).toBeNull();
  });

  it('handles an overnight range (open, late night side)', () => {
    // 2024-01-03T18:00:00Z = Wed 23:00 in Karachi.
    const now = new Date('2024-01-03T18:00:00Z');
    const result = computeOpenNow(hours([{ day: 'Wed', open: '20:00', close: '02:00' }]), KARACHI, now);
    expect(result?.isOpen).toBe(true);
  });

  it('handles an overnight range (open, early morning side)', () => {
    // 2024-01-03T20:00:00Z = Thu 01:00 in Karachi.
    const now = new Date('2024-01-03T20:00:00Z');
    const result = computeOpenNow(hours([{ day: 'Thu', open: '20:00', close: '02:00' }]), KARACHI, now);
    expect(result?.isOpen).toBe(true);
  });

  it('handles an overnight range (closed, mid-afternoon)', () => {
    // 2024-01-03T10:00:00Z = Wed 15:00 in Karachi.
    const now = new Date('2024-01-03T10:00:00Z');
    const result = computeOpenNow(hours([{ day: 'Wed', open: '20:00', close: '02:00' }]), KARACHI, now);
    expect(result?.isOpen).toBe(false);
  });

  it('resolves weekday/time independently for a second, different timezone', () => {
    // 2024-01-03T02:00:00Z = Tue 21:00 in New York (UTC-5) even though the UTC date is Wednesday.
    const now = new Date('2024-01-03T02:00:00Z');
    const result = computeOpenNow(
      hours([{ day: 'Tue', open: '20:00', close: '23:59' }]),
      'America/New_York',
      now,
    );
    expect(result).toEqual({ isOpen: true, localTimeLabel: 'Tuesday 21:00' });
  });
});
