/**
 * Pure "is this business open right now" helper. No DB, no external calls, no
 * `server-only` — must stay importable from the trigger-agnostic aiOrchestrator
 * (see its header comment). See docs/12-KNOWLEDGE-BASE-AND-RETRIEVAL.md §4.3.
 */

export interface HourRow {
  day: string; // 'Mon'..'Sun'
  open: string; // 'HH:MM', 24h
  close: string; // 'HH:MM', 24h
}

/**
 * A holiday/vacation closure window. Rides inside the `business_hours` JSONB as
 * an optional `closures` array, so no migration is needed. `from`/`to` are
 * inclusive calendar dates (YYYY-MM-DD) in the tenant's timezone; `message` is
 * the customer-facing "we're closed / back on…" note. Written by the Business
 * Copilot (docs/19 O5); read here so the AI's "open now?" verdict honours it.
 */
export interface Closure {
  from: string; // 'YYYY-MM-DD', inclusive
  to: string; // 'YYYY-MM-DD', inclusive
  message?: string;
}

export interface OpenNowResult {
  isOpen: boolean;
  localTimeLabel: string; // e.g. "Saturday 14:32"
  /** Set only when a holiday closure is active today — the owner's away message. */
  closureMessage?: string;
}

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_FULL_NAMES: Record<string, string> = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
  Sun: 'Sunday',
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isHourRow(v: unknown): v is HourRow {
  return isRecord(v) && typeof v.day === 'string' && typeof v.open === 'string' && typeof v.close === 'string';
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isClosureRow(v: unknown): v is Closure {
  return isRecord(v) && typeof v.from === 'string' && typeof v.to === 'string' && ISO_DATE.test(v.from) && ISO_DATE.test(v.to);
}

/**
 * The active closure for a tenant-local calendar date (YYYY-MM-DD), or null. A
 * closure covers `from`..`to` inclusive; ISO date strings compare correctly with
 * plain `<=`/`>=` (lexicographic == chronological for zero-padded YYYY-MM-DD).
 */
function activeClosure(businessHours: Record<string, unknown>, localDate: string): Closure | null {
  if (!Array.isArray(businessHours.closures)) return null;
  const closures = businessHours.closures.filter(isClosureRow);
  return closures.find((c) => localDate >= c.from && localDate <= c.to) ?? null;
}

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Handles same-day ranges (11:00-21:00) and overnight ranges (20:00-02:00). */
function isWithinRange(open: string, close: string, nowMinutes: number): boolean {
  const openMin = toMinutes(open);
  const closeMin = toMinutes(close);
  if (openMin === null || closeMin === null || openMin === closeMin) return false;
  return openMin < closeMin
    ? nowMinutes >= openMin && nowMinutes < closeMin
    : nowMinutes >= openMin || nowMinutes < closeMin;
}

/**
 * Given the tenant's structured weekly hours (JSONB, shape is untrusted) and its IANA
 * timezone, returns whether the business is open right now plus a local-time label — or
 * null when hours/timezone aren't configured or the timezone string is invalid.
 */
export function computeOpenNow(
  businessHours: unknown,
  timezone: string | null | undefined,
  now: Date = new Date(),
): OpenNowResult | null {
  if (!timezone || !isRecord(businessHours) || !Array.isArray(businessHours.week)) return null;
  const week = businessHours.week.filter(isHourRow);
  if (!week.length) return null;

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
  } catch {
    return null; // invalid IANA timezone string
  }

  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  if (!DAY_ORDER.includes(weekday)) return null;

  const localTimeLabel = `${DAY_FULL_NAMES[weekday]} ${hour}:${minute}`;

  // A holiday closure overrides the weekly schedule — closed regardless of hours.
  const closure = activeClosure(businessHours, `${year}-${month}-${day}`);
  if (closure) {
    return { isOpen: false, localTimeLabel, ...(closure.message ? { closureMessage: closure.message } : {}) };
  }

  const nowMinutes = Number(hour) * 60 + Number(minute);
  const row = week.find((r) => r.day === weekday);
  const isOpen = Boolean(row && isWithinRange(row.open, row.close, nowMinutes));

  return { isOpen, localTimeLabel };
}

// --- appointment slots (docs/24-APPOINTMENTS.md §3) -------------------------

/** A busy interval to exclude — an existing booking. Both are UTC instants. */
export interface BusyInterval {
  startsAt: Date;
  endsAt: Date;
}

export interface Slot {
  /** The UTC instant. This is what gets stored; never wall-clock text (§3, DST). */
  startsAt: Date;
  /** Human-readable in the tenant's timezone, e.g. "Tue 4 Aug, 3:00 PM" — for the AI to say aloud. */
  label: string;
}

export interface SlotOptions {
  businessHours: unknown;
  timezone: string | null | undefined;
  durationMinutes: number;
  leadTimeMinutes: number;
  maxDaysAhead: number;
  /** Existing bookings to exclude. `hours.ts` stays DB-free — the caller loads these. */
  busy?: BusyInterval[];
  /** Defaults to now. Injectable so the behaviour is testable without faking the clock. */
  from?: Date;
  /** Cap on returned slots, so the model never recites fifty options at a customer. */
  limit?: number;
}

/** The tenant-local Y/M/D and weekday for a UTC instant. */
function localParts(d: Date, timeZone: string): { date: string; weekday: string } | null {
  try {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
    const weekday = get('weekday');
    if (!DAY_ORDER.includes(weekday)) return null;
    return { date: `${get('year')}-${get('month')}-${get('day')}`, weekday };
  } catch {
    return null;
  }
}

/**
 * The UTC instant for a given tenant-local calendar date + wall-clock time.
 *
 * There is no built-in "parse this wall time IN this timezone", so this probes:
 * guess UTC, read back what that instant looks like in the target zone, and
 * correct by the difference. Two passes converge even across a DST boundary
 * (the first correction can land on the wrong side of a transition; the second
 * fixes it). Pakistan has no DST, so this is latent correctness — but storing a
 * slot at the wrong absolute instant would be very hard to unpick later.
 */
function zonedWallTimeToUtc(dateStr: string, minutesOfDay: number, timeZone: string): Date | null {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return null;
  const hh = Math.floor(minutesOfDay / 60);
  const mm = minutesOfDay % 60;

  let guess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0, 0));
  for (let pass = 0; pass < 2; pass++) {
    let parts: Intl.DateTimeFormatPart[];
    try {
      parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(guess);
    } catch {
      return null;
    }
    const get = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? '0');
    const asUtcOfLocal = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    const wanted = Date.UTC(y, m - 1, d, hh, mm, 0);
    const drift = wanted - asUtcOfLocal;
    if (drift === 0) break;
    guess = new Date(guess.getTime() + drift);
  }
  return guess;
}

function formatSlotLabel(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(d)
    .replace(/,\s*(?=\d{1,2}:)/, ', ');
}

/**
 * Bookable slots for a tenant, honouring weekly hours, holiday closures, lead
 * time, the booking window, and existing bookings (docs/24 §3).
 *
 * Pure and DB-free on purpose — same reason as `computeOpenNow`: the
 * trigger-agnostic orchestrator must be able to import this module.
 */
export function computeAvailableSlots(opts: SlotOptions): Slot[] {
  const { businessHours, timezone, durationMinutes, leadTimeMinutes, maxDaysAhead } = opts;
  if (!timezone || !isRecord(businessHours) || !Array.isArray(businessHours.week)) return [];
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return [];

  const week = businessHours.week.filter(isHourRow);
  if (!week.length) return [];

  const from = opts.from ?? new Date();
  const busy = opts.busy ?? [];
  const limit = opts.limit ?? 8;
  const earliest = from.getTime() + leadTimeMinutes * 60_000;
  const horizon = from.getTime() + maxDaysAhead * 24 * 60 * 60_000;

  const out: Slot[] = [];

  // Walk tenant-local days. +1 so an overnight range opening late on the final
  // day still contributes the slots that spill past midnight.
  for (let dayOffset = 0; dayOffset <= maxDaysAhead + 1 && out.length < limit; dayOffset++) {
    const cursor = new Date(from.getTime() + dayOffset * 24 * 60 * 60_000);
    const local = localParts(cursor, timezone);
    if (!local) return [];

    if (activeClosure(businessHours, local.date)) continue;

    const row = week.find((r) => r.day === local.weekday);
    if (!row) continue;

    const openMin = toMinutes(row.open);
    const closeMin = toMinutes(row.close);
    if (openMin === null || closeMin === null || openMin === closeMin) continue;

    // Overnight (20:00-02:00) becomes a range past 1440; zonedWallTimeToUtc
    // normalises the overflow into the following day via Date.UTC rollover.
    const endMin = closeMin > openMin ? closeMin : closeMin + 24 * 60;

    for (let start = openMin; start + durationMinutes <= endMin; start += durationMinutes) {
      if (out.length >= limit) break;

      const startsAt = zonedWallTimeToUtc(local.date, start, timezone);
      if (!startsAt) continue;

      const t = startsAt.getTime();
      if (t < earliest || t > horizon) continue;

      const endsAt = t + durationMinutes * 60_000;
      const clashes = busy.some((b) => t < b.endsAt.getTime() && endsAt > b.startsAt.getTime());
      if (clashes) continue;

      // An overnight range can re-derive a slot already emitted from the
      // previous day's spill-over; dedupe on the instant.
      if (out.some((s) => s.startsAt.getTime() === t)) continue;

      out.push({ startsAt, label: formatSlotLabel(startsAt, timezone) });
    }
  }

  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).slice(0, limit);
}
