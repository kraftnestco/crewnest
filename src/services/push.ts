import 'server-only';
import webpush from 'web-push';
import { createServiceClient } from '@/lib/supabase/service';
import { env } from '@/lib/env';
import { log } from '@/lib/log';

/**
 * Web Push sender (docs/21-WEB-PUSH-NOTIFICATIONS.md §2.1, §2.4).
 *
 * Uses the `web-push` library rather than this repo's usual zero-dependency
 * `fetch` wrapper — a deliberate, documented exception (§2.1): Web Push needs
 * ECDH P-256 + HKDF + AES-128-GCM payload encryption and a signed VAPID JWT,
 * where a subtle hand-rolled mistake fails silently or only in some browsers.
 * That is the wrong failure mode for a notification system.
 *
 * Bolt-on, not a dependency: a no-op whenever the VAPID env vars are unset,
 * exactly like services/email.ts is without RESEND_API_KEY.
 */

/** The push service returns these two, and only these two, to mean "this endpoint is permanently gone." */
const GONE_STATUS_CODES = new Set([404, 410]);

let configured: boolean | null = null;

/** Configure VAPID once per process. Returns false when push isn't provisioned. */
function ensureConfigured(): boolean {
  if (configured !== null) return configured;

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    configured = false;
    return false;
  }

  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    configured = true;
  } catch (err) {
    // Malformed keys are a provisioning error, not a runtime one — log loudly
    // once and then behave as unconfigured rather than throwing on every send.
    log.error('[push] invalid VAPID configuration — push disabled', {
      error: err instanceof Error ? err.message : String(err),
    });
    configured = false;
  }
  return configured;
}

/** True when push is provisioned — lets callers skip the DB lookup entirely. */
export function isPushConfigured(): boolean {
  return ensureConfigured();
}

export interface PushPayload {
  title: string;
  body: string;
  link: string;
  /** Collapses repeats of the same event on the device instead of stacking buzzes. */
  tag?: string;
}

/**
 * Send one payload to every registered device of the given users.
 *
 * Best-effort and parallel, never throwing into the caller's hot path — same
 * posture as the email fan-out it sits beside. Prunes subscriptions the push
 * service reports as permanently gone (404/410 only, §2.4): any other failure
 * (network blip, 5xx, timeout) is logged and the row is LEFT ALONE, since
 * deleting on a transient error would silently unsubscribe a working device.
 */
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  if (!ensureConfigured() || userIds.length === 0) return;

  try {
    const client = createServiceClient();
    const { data: subs, error } = await client
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .in('user_id', userIds);
    if (error) throw error;
    if (!subs?.length) return;

    const body = JSON.stringify(payload);
    const deadSubscriptionIds: string[] = [];

    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            body,
          );
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode !== undefined && GONE_STATUS_CODES.has(statusCode)) {
            deadSubscriptionIds.push(sub.id);
            return;
          }
          // Metadata only — never the payload (it may name a customer) or keys.
          log.warn('[push] send failed', { statusCode: statusCode ?? 'unknown' });
        }
      }),
    );

    if (deadSubscriptionIds.length > 0) {
      const { error: pruneError } = await client
        .from('push_subscriptions')
        .delete()
        .in('id', deadSubscriptionIds);
      if (pruneError) {
        log.warn('[push] pruning expired subscriptions failed', { error: pruneError.message });
      }
    }
  } catch (err) {
    log.error('[push] fan-out failed', { error: err instanceof Error ? err.message : String(err) });
  }
}
