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

export interface OpenNowResult {
  isOpen: boolean;
  localTimeLabel: string; // e.g. "Saturday 14:32"
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
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
  } catch {
    return null; // invalid IANA timezone string
  }

  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  if (!DAY_ORDER.includes(weekday)) return null;

  const nowMinutes = Number(hour) * 60 + Number(minute);
  const row = week.find((r) => r.day === weekday);
  const isOpen = Boolean(row && isWithinRange(row.open, row.close, nowMinutes));

  return { isOpen, localTimeLabel: `${DAY_FULL_NAMES[weekday]} ${hour}:${minute}` };
}
