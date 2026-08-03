/**
 * Customer-facing order/appointment references (docs/24-style decision, 2026-08-03).
 *
 * Format: `KN-0803-5` — business initials, the placement date (MMDD), then the
 * per-tenant sequential number from migration 0040.
 *
 * Why not the bare number: "#5" reads like a test rather than a real reference,
 * and it advertises exactly how few orders a business has taken. Why not a
 * random code: staff lose the at-a-glance ordering, and it would need its own
 * uniqueness handling. This keeps the sequential number as the source of truth
 * — the reference is a display format over it, nothing more.
 *
 * No `server-only` import: this is pure formatting, needed on both the server
 * (tool results, customer messages) and the client (dashboard tables).
 */

/**
 * Two-letter prefix from the business name: initials of the first two words,
 * else the first two letters of a single-word name. Non-letters are stripped
 * so punctuation or digits can't produce something like "K-" or "1N".
 *
 * Falls back to 'OR' (order) when a name yields no usable letters at all —
 * better a generic-but-valid reference than a malformed one in a customer's
 * message.
 */
export function businessPrefix(businessName: string | null | undefined): string {
  const cleaned = (businessName ?? '')
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ''))
    .filter(Boolean);

  if (cleaned.length === 0) return 'OR';

  // Split camel-case inside a word so "KraftNest" contributes K and N, not K
  // and its own second letter. Business names are frequently written this way
  // and "KA" reads as a typo where "KN" reads as intended.
  const parts = cleaned.flatMap((w) => w.split(/(?=[A-Z])/).filter(Boolean));

  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase().padEnd(2, 'X');
}

/**
 * MMDD in the TENANT's timezone, not the server's or the viewer's — the date on
 * a customer's reference must match the day it was placed for them. Falls back
 * to UTC when the tenant has no timezone configured.
 */
function monthDay(iso: string, timezone: string | null | undefined): string {
  const d = new Date(iso);
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'UTC',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('month')}${get('day')}`;
  } catch {
    // Invalid IANA string — don't throw inside a reference used in a reply.
    return `${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  }
}

/**
 * The full reference, e.g. `KN-0803-5`.
 *
 * Returns null when there's no sequential number — that only happens in the
 * narrow crash window migration 0040's atomic claim otherwise prevents, and
 * callers already handle a missing reference by falling back to wording like
 * "your order" rather than printing something broken.
 */
export function orderRef(args: {
  businessName: string | null | undefined;
  number: number | null | undefined;
  createdAt: string;
  timezone?: string | null;
}): string | null {
  if (args.number == null) return null;
  return `${businessPrefix(args.businessName)}-${monthDay(args.createdAt, args.timezone)}-${args.number}`;
}
