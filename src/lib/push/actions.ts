'use server';

import { z } from 'zod';
import { getCallerContext } from '@/lib/auth/context';
import { createServiceClient } from '@/lib/supabase/service';
import { log } from '@/lib/log';

/**
 * Push subscription server actions (docs/21-WEB-PUSH-NOTIFICATIONS.md §2.4, §3).
 *
 * These use the SERVICE client deliberately: `push_subscriptions` has no insert
 * policy by design, so the row's `user_id` is bound here from the verified
 * session and never from client input — same posture as services/teamMembers.ts
 * ("callers must bind tenantId server-side, never from client input"). The
 * browser supplies only its own endpoint and its own public keys.
 */

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  p256dh: z.string().min(1).max(500),
  auth: z.string().min(1).max(500),
});

export interface PushActionResult {
  success: boolean;
  error: string | null;
}

export async function savePushSubscriptionAction(
  raw: unknown,
  userAgent?: string,
): Promise<PushActionResult> {
  const ctx = await getCallerContext();
  if (!ctx) return { success: false, error: 'Not signed in.' };

  const parsed = subscriptionSchema.safeParse(raw);
  if (!parsed.success) return { success: false, error: 'That subscription was not valid.' };
  const sub = parsed.data;

  try {
    const client = createServiceClient();
    // `endpoint` is globally unique, so re-subscribing the same browser (which
    // happens whenever the push service rotates it) updates in place instead of
    // accumulating dead rows. onConflict re-binds user_id too, correctly
    // re-homing an endpoint if a different person signs in on that browser.
    const { error } = await client.from('push_subscriptions').upsert(
      {
        user_id: ctx.userId,
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        auth: sub.auth,
        user_agent: userAgent?.slice(0, 500) ?? null,
      },
      { onConflict: 'endpoint' },
    );
    if (error) throw error;
    return { success: true, error: null };
  } catch (err) {
    log.error('[push] saving subscription failed', {
      userId: ctx.userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { success: false, error: "Couldn't turn on notifications. Please try again." };
  }
}

/**
 * Does a push subscription for THIS endpoint exist under the CALLING user?
 *
 * The browser's own `pushManager.getSubscription()` only proves a subscription
 * exists somewhere for this browser — one browser holds exactly one push
 * subscription regardless of which app account is currently logged in, so
 * switching accounts in the same browser (log out of Tenant A, log into
 * Tenant B) leaves the OS-level subscription in place while it's still bound
 * to Tenant A's user_id in the database. Without this check the toggle would
 * show "on" for Tenant B while nothing is actually wired to notify them.
 */
export async function isEndpointSubscribedToMeAction(endpoint: string): Promise<boolean> {
  const ctx = await getCallerContext();
  if (!ctx) return false;

  const client = createServiceClient();
  const { data, error } = await client
    .from('push_subscriptions')
    .select('id')
    .eq('endpoint', endpoint)
    .eq('user_id', ctx.userId)
    .maybeSingle();
  if (error) {
    log.error('[push] endpoint ownership check failed', { error: error.message });
    return false;
  }
  return data !== null;
}

export async function deletePushSubscriptionAction(endpoint: string): Promise<PushActionResult> {
  const ctx = await getCallerContext();
  if (!ctx) return { success: false, error: 'Not signed in.' };

  try {
    const client = createServiceClient();
    // Scoped to the caller's own rows: the service client bypasses RLS, so this
    // `.eq('user_id', …)` is the actual guard, not decoration.
    const { error } = await client
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', endpoint)
      .eq('user_id', ctx.userId);
    if (error) throw error;
    return { success: true, error: null };
  } catch (err) {
    log.error('[push] deleting subscription failed', {
      userId: ctx.userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { success: false, error: "Couldn't turn off notifications. Please try again." };
  }
}
