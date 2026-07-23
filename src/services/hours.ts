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
