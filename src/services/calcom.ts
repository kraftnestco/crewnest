import 'server-only';
import { env } from '@/lib/env';
import { log } from '@/lib/log';

/**
 * Cal.com client — a MEETING-LINK GENERATOR, nothing more
 * (docs/24-APPOINTMENTS.md §1.1, §4.4).
 *
 * ClerkNest owns the schedule. Cal.com is called only after a slot has already
 * been decided and inserted, purely to mint a Google Meet URL for tenants with
 * `bookingMode='calcom'`. We never read availability from Cal.com: one
 * ClerkNest-owned Cal.com account means its availability is shared across every
 * tenant, so two businesses would collide on the same hour.
 *
 * API versions are PER-ENDPOINT and differ; a wrong one returns a confusing
 * 400. These were verified live 2026-08-03 against the real account.
 */

const BASE = 'https://api.cal.com/v2';
const BOOKINGS_API_VERSION = '2024-08-13';

export function isCalcomConfigured(): boolean {
  return Boolean(env.CALCOM_API_KEY && env.CALCOM_EVENT_TYPE_ID);
}

export interface CalcomBooking {
  uid: string;
  meetingUrl: string | null;
}

/**
 * Create a Cal.com booking and return its meeting URL.
 *
 * Returns null on ANY failure rather than throwing — docs/24 §4.3: the
 * appointment is already booked and the customer has already been told a time.
 * Rolling that back because a link generator hiccuped is far worse than a
 * booked appointment with a blank link, which is visible in the dashboard and
 * fixable by hand.
 */
export async function createBooking(args: {
  startsAt: Date;
  customerName: string;
  timeZone: string;
}): Promise<CalcomBooking | null> {
  if (!isCalcomConfigured()) return null;

  try {
    const res = await fetch(`${BASE}/bookings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CALCOM_API_KEY}`,
        'cal-api-version': BOOKINGS_API_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        start: args.startsAt.toISOString(),
        eventTypeId: Number(env.CALCOM_EVENT_TYPE_ID),
        attendee: {
          name: args.customerName,
          // A single fixed ClerkNest address, by decision (docs/24 §4.4):
          // WhatsApp/Instagram customers have no email on file and asking for
          // one mid-booking is friction for something they don't need. The
          // customer's real NAME still rides along, so the calendar event
          // identifies them. Consequence: Cal.com's confirmations go to us,
          // not the customer — the customer's record is the chat message.
          email: env.CALCOM_ATTENDEE_EMAIL || 'bookings@example.com',
          timeZone: args.timeZone,
          language: 'en',
        },
        metadata: { source: 'clerknest' },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      log.error('[calcom] booking failed', { status: res.status, body: (await res.text()).slice(0, 300) });
      return null;
    }

    const json = (await res.json()) as { data?: { uid?: string; meetingUrl?: string; location?: string } };
    const uid = json.data?.uid;
    if (!uid) {
      log.error('[calcom] booking response had no uid');
      return null;
    }
    // `meetingUrl` is the documented field; `location` mirrors it for
    // integration locations. Fall back so a shape change doesn't lose the link.
    return { uid, meetingUrl: json.data?.meetingUrl ?? json.data?.location ?? null };
  } catch (err) {
    log.error('[calcom] booking threw', { error: err instanceof Error ? err.message : 'unknown' });
    return null;
  }
}

/**
 * Cancel a Cal.com booking. Best-effort for the same reason as above: the
 * ClerkNest-side cancellation is the source of truth, and a failure here leaves
 * a stale Cal.com entry — untidy, but it must never block the customer's
 * cancellation from succeeding.
 */
export async function cancelBooking(uid: string, reason = 'Cancelled by customer'): Promise<boolean> {
  if (!isCalcomConfigured()) return false;

  try {
    const res = await fetch(`${BASE}/bookings/${encodeURIComponent(uid)}/cancel`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CALCOM_API_KEY}`,
        'cal-api-version': BOOKINGS_API_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cancellationReason: reason }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      log.warn('[calcom] cancel failed — ClerkNest-side cancellation still stands', { status: res.status });
      return false;
    }
    return true;
  } catch (err) {
    log.warn('[calcom] cancel threw — ClerkNest-side cancellation still stands', {
      error: err instanceof Error ? err.message : 'unknown',
    });
    return false;
  }
}
