import { describe, expect, it } from 'vitest';
import { isUnfinished } from './appointmentWindow';

describe('isUnfinished', () => {
  // The real case: a 30-minute appointment at 16:30 Karachi (11:30 UTC).
  const appt = { starts_at: '2026-08-04T11:30:00+00:00', duration_minutes: 30 };

  it('is upcoming before it starts', () => {
    expect(isUnfinished(appt, new Date('2026-08-04T10:00:00Z'))).toBe(true);
  });

  it('STAYS upcoming while in progress — the first bug', () => {
    // 4:38pm Karachi: started, not finished. This vanished from the dashboard.
    expect(isUnfinished(appt, new Date('2026-08-04T11:38:00Z'))).toBe(true);
  });

  it('is upcoming right up to the final second', () => {
    expect(isUnfinished(appt, new Date('2026-08-04T11:59:59Z'))).toBe(true);
  });

  it('is NOT upcoming once it ends', () => {
    expect(isUnfinished(appt, new Date('2026-08-04T12:00:00Z'))).toBe(false);
  });

  it('is NOT upcoming well after — the second bug', () => {
    // 6:15pm Karachi: ended 75 minutes ago. The 4-hour window still showed it.
    expect(isUnfinished(appt, new Date('2026-08-04T13:15:00Z'))).toBe(false);
  });

  it('respects a longer duration', () => {
    const long = { starts_at: '2026-08-04T11:30:00+00:00', duration_minutes: 120 };
    expect(isUnfinished(long, new Date('2026-08-04T13:15:00Z'))).toBe(true);
    expect(isUnfinished(long, new Date('2026-08-04T13:31:00Z'))).toBe(false);
  });
});
