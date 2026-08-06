import { type NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { env } from '@/lib/env';
import { getSafepayClientForWebhook, parseReference, persistSubscriptionIds } from '@/services/safepay';
import { planDisplayName, type PaidPlanId } from '@/lib/entitlements';
import { createServiceClient } from '@/lib/supabase/service';
import { notifyBoth, notify } from '@/services/notifications';
import { log } from '@/lib/log';

/**
 * Safepay webhook (docs/25 §4). THE ONLY writer of `tenants.plan`/`plan_status`
 * for Safepay tenants — the checkout redirect is optimistic UI only, never a
 * source of truth, for the same reason documented on the Stripe webhook and in
 * docs/15 §1: trusting a client-side redirect is a silent-failure shape.
 *
 * Idempotency mirrors stripe_events / webhook_events (docs/15 §3.1): a
 * `safepay_events` row keyed on the provider's own event id, inserted BEFORE
 * processing, so a redelivery can never double-apply.
 */
export const runtime = 'nodejs';
export const maxDuration = 30;

/** Safepay's subscription lifecycle states we act on (SDK: SubscriptionStatus). */
const ACTIVE_STATUSES = new Set(['ACTIVE', 'TRAILING']);
const DUNNING_STATUSES = new Set(['PAST_DUE', 'UNPAID', 'INCOMPLETE']);
const ENDED_STATUSES = new Set(['CANCELED', 'ENDED', 'INCOMPLETE_EXPIRED']);

export async function POST(req: NextRequest) {
  if (!env.SAFEPAY_WEBHOOK_SECRET) {
    log.error('[safepay webhook] rejected — SAFEPAY_WEBHOOK_SECRET not provisioned');
    return new Response('Forbidden', { status: 403 });
  }

  // Raw body first — the HMAC is over exact bytes (same rule as Meta/Stripe).
  // The SDK verifies over JSON.stringify(body.data), so we parse only after
  // capturing the raw text, and hand the SDK the parsed shape it expects.
  const rawBody = await req.text();

  let parsed: SafepayWebhookBody;
  try {
    parsed = JSON.parse(rawBody) as SafepayWebhookBody;
  } catch {
    log.error('[safepay webhook] unparseable body');
    return new Response('Bad Request', { status: 400 });
  }

  const signature = req.headers.get('x-sfpy-signature');
  if (!signature) return new Response('Missing signature', { status: 401 });

  let valid = false;
  try {
    valid = getSafepayClientForWebhook().verify.webhook({
      body: parsed,
      headers: { 'x-sfpy-signature': signature },
    });
  } catch (err) {
    log.error('[safepay webhook] signature verification threw', {
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response('Invalid signature', { status: 401 });
  }
  if (!valid) {
    log.error('[safepay webhook] signature verification failed');
    return new Response('Invalid signature', { status: 401 });
  }

  const eventId = parsed.data?.tracker ?? parsed.token ?? null;
  const eventType = parsed.type ?? parsed.data?.type ?? 'unknown';
  if (!eventId) {
    // No id means no idempotency key. ACK so Safepay stops retrying an event we
    // can never safely process, but record it loudly — this is a contract change.
    log.error('[safepay webhook] event carried no id; cannot dedupe', { eventType });
    return new Response('OK', { status: 200 });
  }

  // The ledger insert IS the gate (docs/15 §3.1). Only a winning insert proceeds.
  const svc = createServiceClient();
  const { error: ledgerError } = await svc
    .from('safepay_events')
    .insert({ id: eventId, type: eventType });
  if (ledgerError) {
    if (ledgerError.code === '23505') return new Response('OK', { status: 200 }); // already processed
    log.error('[safepay webhook] ledger insert failed', { error: ledgerError.message });
    return new Response('Internal error', { status: 500 });
  }

  try {
    await handleEvent(parsed);
  } catch (err) {
    log.error('[safepay webhook] event handling failed', {
      type: eventType,
      error: err instanceof Error ? err.message : String(err),
    });
    Sentry.captureException(err, { tags: { source: 'safepay-webhook', eventType } });
    // Same accepted, disclosed gap as the Stripe webhook: the ledger row exists,
    // so a retry is skipped rather than reprocessed. A genuinely failed event
    // needs a human, not a retry loop.
    return new Response('Internal error', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}

async function handleEvent(body: SafepayWebhookBody): Promise<void> {
  const sub = body.data?.subscription ?? body.data ?? null;
  const status = (sub?.status ?? '').toUpperCase();

  // The tenant is resolved from OUR server-set reference, never from anything
  // the client could influence — the same posture as Stripe's client_reference_id.
  const ref = parseReference(sub?.reference ?? body.data?.reference ?? null);

  if (ACTIVE_STATUSES.has(status)) return handleActivated(body, ref);
  if (DUNNING_STATUSES.has(status)) return handleDunning(sub?.token ?? null);
  if (ENDED_STATUSES.has(status)) return handleEnded(sub?.token ?? null);

  // Unhandled statuses are expected — Safepay emits more than we act on.
  return;
}

/** The plan flip. Mirrors handleCheckoutCompleted on the Stripe side. */
async function handleActivated(
  body: SafepayWebhookBody,
  ref: { tenantId: string; planId: PaidPlanId } | null,
): Promise<void> {
  if (!ref) {
    log.error('[safepay webhook] activation event without a resolvable reference', {
      tracker: body.data?.tracker,
    });
    return;
  }

  const sub = body.data?.subscription ?? body.data ?? null;
  const subscriptionId = sub?.token ?? null;

  const svc = createServiceClient();
  const { error } = await svc
    .from('tenants')
    .update({ plan: ref.planId, plan_status: null, billing_provider: 'safepay' })
    .eq('id', ref.tenantId);
  if (error) throw error;

  // Recorded so the recurring charge is auditable: Safepay bills a FIXED amount
  // set on the plan, so this is what this tenant will be charged every cycle.
  await persistSubscriptionIds({
    tenantId: ref.tenantId,
    subscriptionId,
    customerId: sub?.user_id ?? null,
    amountMinor: toMinorUnits(sub?.price_amount),
    currency: sub?.price_currency ?? null,
  });

  const { data: tenant } = await svc
    .from('tenants')
    .select('business_name')
    .eq('id', ref.tenantId)
    .maybeSingle();

  await notifyBoth({
    tenantId: ref.tenantId,
    type: 'upgrade_request',
    agency: {
      title: `${tenant?.business_name ?? 'A client'} is now on ${ref.planId}`,
      body: 'Payment confirmed via Safepay.',
      link: `/admin/clients/${ref.tenantId}`,
    },
    tenant: {
      title: `You're now on ${planDisplayName(ref.planId)}`,
      body: 'Thanks for upgrading — your new plan is active now.',
      link: '/dashboard/billing',
    },
  });
}

/** Payment trouble short of cancellation — flag without changing the tier, as Stripe does. */
async function handleDunning(subscriptionId: string | null): Promise<void> {
  if (!subscriptionId) return;
  const svc = createServiceClient();
  const { data: tenant, error: lookupError } = await svc
    .from('tenants')
    .select('id, business_name, plan_status')
    .eq('safepay_subscription_id', subscriptionId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!tenant || tenant.plan_status === 'payment_failed') return; // don't re-notify on every retry

  const { error } = await svc.from('tenants').update({ plan_status: 'payment_failed' }).eq('id', tenant.id);
  if (error) throw error;

  await notify({
    scope: 'tenant',
    tenantId: tenant.id,
    type: 'upgrade_request',
    title: 'Payment failed',
    body: "We couldn't charge your payment method. Please update it to keep your plan active.",
    link: '/dashboard/billing',
  });
}

/** Cancelled or finally failed — downgrade to free, subject to the existing free-plan caps. */
async function handleEnded(subscriptionId: string | null): Promise<void> {
  if (!subscriptionId) return;
  const svc = createServiceClient();
  const { data: tenant, error: lookupError } = await svc
    .from('tenants')
    .select('id, business_name')
    .eq('safepay_subscription_id', subscriptionId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!tenant) {
    log.warn('[safepay webhook] ended event for unknown subscription', { subscriptionId });
    return;
  }

  const { error } = await svc
    .from('tenants')
    .update({
      plan: 'free',
      plan_status: null,
      safepay_subscription_id: null,
      safepay_amount_minor: null,
      safepay_currency: null,
    })
    .eq('id', tenant.id);
  if (error) throw error;

  await notifyBoth({
    tenantId: tenant.id,
    type: 'upgrade_request',
    agency: {
      title: `${tenant.business_name} moved to the free plan`,
      body: 'Their Safepay subscription ended (cancelled or payment ultimately failed).',
      link: `/admin/clients/${tenant.id}`,
    },
    tenant: {
      title: "You're now on the Free plan",
      body: 'Your subscription ended. You can resubscribe anytime from Billing.',
      link: '/dashboard/billing',
    },
  });
}

/** Safepay reports amounts as decimal strings; store minor units. Unparseable ⇒ null, never 0. */
function toMinorUnits(amount: string | number | null | undefined): number | null {
  if (amount === null || amount === undefined) return null;
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/**
 * Shape of the Safepay webhook body we consume. Hand-written (the SDK types its
 * API responses, not its webhooks) and intentionally tolerant: every field is
 * optional, because an unexpected payload must fail the reference/status checks
 * above and be ignored, never crash the route into a retry loop.
 */
interface SafepayWebhookSubscription {
  token?: string | null;
  status?: string | null;
  reference?: string | null;
  user_id?: string | null;
  price_amount?: string | number | null;
  price_currency?: string | null;
}

interface SafepayWebhookBody {
  token?: string | null;
  type?: string | null;
  data?: (SafepayWebhookSubscription & {
    tracker?: string | null;
    type?: string | null;
    subscription?: SafepayWebhookSubscription | null;
  }) | null;
}
