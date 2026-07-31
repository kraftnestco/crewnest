import { type NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import type Stripe from 'stripe';
import { env } from '@/lib/env';
import { getStripeClientForWebhook } from '@/services/stripe';
import { createServiceClient } from '@/lib/supabase/service';
import { notifyBoth, notify } from '@/services/notifications';
import { log } from '@/lib/log';

/**
 * Stripe webhook (docs/22-BILLING-STRIPE.md §2.3, §4). THE ONLY writer of
 * `tenants.plan`/`plan_status` once billing is live — the checkout success
 * page is optimistic UI only, never itself a source of truth, for the exact
 * reason docs/15 §1 documents about the Meta pipeline: trusting a client-side
 * redirect as truth is the same silent-failure shape that bit `after()`.
 *
 * Idempotency mirrors webhook_events (docs/15 §3.1): a `stripe_events` row
 * keyed on Stripe's own event.id, inserted BEFORE processing — Stripe retries
 * undelivered webhooks for up to 3 days, so a redelivery must never double-apply.
 */
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    log.error('[stripe webhook] rejected — STRIPE_WEBHOOK_SECRET not provisioned');
    return new Response('Forbidden', { status: 403 });
  }

  // Raw body required for signature verification — same rule as the Meta webhook.
  const rawBody = await req.text();
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('Missing signature', { status: 401 });

  let event: Stripe.Event;
  try {
    const stripe = getStripeClientForWebhook();
    event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    log.error('[stripe webhook] signature verification failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response('Invalid signature', { status: 401 });
  }

  // Enqueue-time-style dedup (docs/15 §3.1 pattern): the ledger insert IS the
  // gate. Only a WINNING insert proceeds to processing; a 23505 means this
  // event was already handled (or is concurrently being handled) — skip.
  const svc = createServiceClient();
  const { error: ledgerError } = await svc
    .from('stripe_events')
    .insert({ id: event.id, type: event.type });
  if (ledgerError) {
    if (ledgerError.code === '23505') return new Response('OK', { status: 200 }); // already processed
    log.error('[stripe webhook] ledger insert failed', { error: ledgerError.message });
    return new Response('Internal error', { status: 500 });
  }

  try {
    await handleEvent(event);
  } catch (err) {
    log.error('[stripe webhook] event handling failed', {
      type: event.type,
      error: err instanceof Error ? err.message : String(err),
    });
    Sentry.captureException(err, { tags: { source: 'stripe-webhook', eventType: event.type } });
    // Non-2xx tells Stripe to retry. The ledger row already exists, so on
    // retry this event will be skipped as "already processed" above rather
    // than reprocessed — a genuinely failed event needs a human, not a loop.
    // This is an accepted, disclosed gap (mirrors docs/15 §3.3's residual
    // window note): rare, and a silent drop would be worse.
    return new Response('Internal error', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
    case 'customer.subscription.deleted':
      return handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
    case 'customer.subscription.updated':
      return handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
    default:
      // Unhandled event types are expected and fine — Stripe sends many more
      // event types than this integration acts on.
      return;
  }
}

/** docs/22 §2.3 step 3 — the actual plan flip. Never trusts client-supplied ids: tenant_id comes from server-set metadata/client_reference_id at Checkout-creation time. */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const tenantId = session.client_reference_id ?? session.metadata?.tenant_id;
  const planId = session.metadata?.plan_id;
  if (!tenantId || (planId !== 'starter' && planId !== 'pro')) {
    log.error('[stripe webhook] checkout.session.completed missing tenant_id/plan_id', {
      sessionId: session.id,
    });
    return;
  }

  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : (session.subscription?.id ?? null);

  const svc = createServiceClient();
  const { error } = await svc
    .from('tenants')
    .update({ plan: planId, plan_status: null, stripe_subscription_id: subscriptionId })
    .eq('id', tenantId);
  if (error) throw error;

  const { data: tenant } = await svc.from('tenants').select('business_name').eq('id', tenantId).maybeSingle();
  await notifyBoth({
    tenantId,
    type: 'upgrade_request',
    agency: {
      title: `${tenant?.business_name ?? 'A client'} is now on ${planId}`,
      body: 'Payment confirmed via Stripe.',
      link: `/admin/clients/${tenantId}`,
    },
    tenant: {
      title: `You're now on ${planId === 'starter' ? 'Starter' : 'Pro'}`,
      body: 'Thanks for upgrading — your new plan is active now.',
      link: '/dashboard/billing',
    },
  });
}

/** docs/22 §2.4 — cancellation or final unrecoverable payment failure both land here (Stripe fires this once a subscription is truly gone). Downgrades to free; the tenant becomes subject to the EXISTING free-plan caps, unchanged. */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const svc = createServiceClient();
  const { data: tenant, error: lookupError } = await svc
    .from('tenants')
    .select('id, business_name')
    .eq('stripe_subscription_id', subscription.id)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!tenant) {
    log.warn('[stripe webhook] subscription.deleted for unknown subscription', { subscriptionId: subscription.id });
    return;
  }

  const { error } = await svc
    .from('tenants')
    .update({ plan: 'free', plan_status: null, stripe_subscription_id: null })
    .eq('id', tenant.id);
  if (error) throw error;

  await notifyBoth({
    tenantId: tenant.id,
    type: 'upgrade_request',
    agency: {
      title: `${tenant.business_name} moved to the free plan`,
      body: 'Their Stripe subscription ended (cancelled or payment ultimately failed).',
      link: `/admin/clients/${tenant.id}`,
    },
    tenant: {
      title: "You're now on the Free plan",
      body: 'Your subscription ended. You can resubscribe anytime from Billing.',
      link: '/dashboard/billing',
    },
  });
}

/** docs/22 §2.4 — the subscription moved to a non-active status short of full deletion (Stripe's own Smart Retries dunning in progress). Flags plan_status without changing plan, so the tenant keeps their tier while the card issue is being resolved. */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  if (subscription.status !== 'past_due' && subscription.status !== 'unpaid') return;

  const svc = createServiceClient();
  const { data: tenant, error: lookupError } = await svc
    .from('tenants')
    .select('id, business_name, plan_status')
    .eq('stripe_subscription_id', subscription.id)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!tenant || tenant.plan_status === 'payment_failed') return; // already flagged — don't re-notify every retry

  const { error } = await svc.from('tenants').update({ plan_status: 'payment_failed' }).eq('id', tenant.id);
  if (error) throw error;

  await notify({
    scope: 'tenant',
    tenantId: tenant.id,
    type: 'upgrade_request',
    title: 'Payment failed',
    body: "We couldn't charge your card. Please update your payment method to keep your plan active.",
    link: '/dashboard/billing',
  });
}
