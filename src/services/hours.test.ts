import { describe, expect, it } from 'vitest';
import { computeAvailableSlots, computeOpenNow } from './hours';

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

// --- computeAvailableSlots (docs/24-APPOINTMENTS.md §3) ---------------------

describe('computeAvailableSlots', () => {
  const base = {
    timezone: KARACHI,
    durationMinutes: 30,
    leadTimeMinutes: 0,
    maxDaysAhead: 7,
  };

  it('generates slots stepping by duration inside the open range', () => {
    // Wed 2024-01-03, 00:00 Karachi = 2024-01-02T19:00Z.
    const from = new Date('2024-01-02T19:00:00Z');
    const slots = computeAvailableSlots({
      ...base,
      businessHours: hours([{ day: 'Wed', open: '09:00', close: '11:00' }]),
      from,
    });
    // 09:00, 09:30, 10:00, 10:30 — 11:00 would end past close.
    expect(slots).toHaveLength(4);
    expect(slots[0].startsAt.toISOString()).toBe('2024-01-03T04:00:00.000Z'); // 09:00 Karachi
    expect(slots[3].startsAt.toISOString()).toBe('2024-01-03T05:30:00.000Z'); // 10:30 Karachi
  });

  it('labels slots in the tenant timezone, not UTC', () => {
    const from = new Date('2024-01-02T19:00:00Z');
    const slots = computeAvailableSlots({
      ...base,
      businessHours: hours([{ day: 'Wed', open: '15:00', close: '16:00' }]),
      from,
    });
    expect(slots[0].label).toContain('3:00');
    expect(slots[0].label.toLowerCase()).toContain('pm');
  });

  it('honours lead time — no slot sooner than now + leadTimeMinutes', () => {
    // Wed 09:10 Karachi; a 120-minute lead means nothing before 11:10.
    const from = new Date('2024-01-03T04:10:00Z');
    const slots = computeAvailableSlots({
      ...base,
      leadTimeMinutes: 120,
      businessHours: hours([{ day: 'Wed', open: '09:00', close: '18:00' }]),
      from,
    });
    expect(slots[0].startsAt.getTime()).toBeGreaterThanOrEqual(from.getTime() + 120 * 60_000);
  });

  it('excludes slots overlapping an existing booking', () => {
    const from = new Date('2024-01-02T19:00:00Z');
    const taken = new Date('2024-01-03T04:30:00.000Z'); // 09:30 Karachi
    const slots = computeAvailableSlots({
      ...base,
      businessHours: hours([{ day: 'Wed', open: '09:00', close: '11:00' }]),
      from,
      busy: [{ startsAt: taken, endsAt: new Date(taken.getTime() + 30 * 60_000) }],
    });
    expect(slots.map((s) => s.startsAt.toISOString())).not.toContain('2024-01-03T04:30:00.000Z');
    expect(slots).toHaveLength(3);
  });

  it('skips days inside a holiday closure', () => {
    const from = new Date('2024-01-02T19:00:00Z');
    const slots = computeAvailableSlots({
      ...base,
      businessHours: {
        week: [{ day: 'Wed', open: '09:00', close: '11:00' }],
        closures: [{ from: '2024-01-03', to: '2024-01-03' }],
      },
      from,
    });
    // Wednesday is closed; the next Wed is 7 days out, past maxDaysAhead of 7
    // only by hours — so assert nothing lands on the closed date itself.
    expect(slots.every((s) => !s.startsAt.toISOString().startsWith('2024-01-03'))).toBe(true);
  });

  it('respects the limit', () => {
    const from = new Date('2024-01-02T19:00:00Z');
    const slots = computeAvailableSlots({
      ...base,
      businessHours: hours([{ day: 'Wed', open: '09:00', close: '18:00' }]),
      from,
      limit: 3,
    });
    expect(slots).toHaveLength(3);
  });

  it('handles an overnight range crossing midnight', () => {
    const from = new Date('2024-01-02T19:00:00Z'); // Wed 00:00 Karachi
    const slots = computeAvailableSlots({
      ...base,
      durationMinutes: 60,
      businessHours: hours([{ day: 'Wed', open: '22:00', close: '02:00' }]),
      from,
      limit: 10,
    });
    // 22:00, 23:00, 00:00, 01:00 Karachi — the last two fall on Thursday.
    expect(slots.length).toBeGreaterThanOrEqual(4);
    expect(slots[0].startsAt.toISOString()).toBe('2024-01-03T17:00:00.000Z'); // 22:00 Wed
    expect(slots[2].startsAt.toISOString()).toBe('2024-01-03T19:00:00.000Z'); // 00:00 Thu
  });

  it('returns [] when hours or timezone are unconfigured', () => {
    const from = new Date('2024-01-02T19:00:00Z');
    expect(computeAvailableSlots({ ...base, businessHours: null, from })).toEqual([]);
    expect(
      computeAvailableSlots({ ...base, timezone: null, businessHours: hours([{ day: 'Wed', open: '09:00', close: '11:00' }]), from }),
    ).toEqual([]);
  });

  it('resolves wall-clock to the correct instant across a DST transition', () => {
    // London: BST (UTC+1) on 2024-03-30, GMT->BST switch overnight 2024-03-31.
    // 10:00 on 2024-04-01 is BST, so 09:00Z — not 10:00Z.
    const from = new Date('2024-04-01T00:00:00Z');
    const slots = computeAvailableSlots({
      ...base,
      timezone: 'Europe/London',
      businessHours: hours([{ day: 'Mon', open: '10:00', close: '11:00' }]),
      from,
      limit: 1,
    });
    expect(slots[0].startsAt.toISOString()).toBe('2024-04-01T09:00:00.000Z');
  });
});
