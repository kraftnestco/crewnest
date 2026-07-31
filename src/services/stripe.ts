import 'server-only';
import Stripe from 'stripe';
import { env } from '@/lib/env';
import { createServiceClient } from '@/lib/supabase/service';
import type { Tenant } from '@/types/domain';

/**
 * Stripe wrapper (docs/22-BILLING-STRIPE.md §4). Thin: create a Checkout
 * Session, create a Customer Portal link. All actual state changes (plan/
 * plan_status) happen in the webhook (api/webhooks/stripe/route.ts), never
 * here — this module only talks TO Stripe, never writes tenant state.
 *
 * Billing has no meaningful "unconfigured, no-op" mode the way Resend/push do
 * (docs/22 §4's env note): a paywall that pretends to work but never actually
 * charges anyone is a worse failure than a clear error, so callers here throw
 * rather than silently returning null when Stripe isn't configured.
 */

let stripeClient: Stripe | null = null;

function getStripeClient(): Stripe {
  if (stripeClient) return stripeClient;
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('Billing is not configured (STRIPE_SECRET_KEY unset).');
  }
  stripeClient = new Stripe(env.STRIPE_SECRET_KEY);
  return stripeClient;
}

/** `PAYWALL_PLANS.id` → the Stripe Price id to subscribe to (docs/22 §4). */
export function priceIdForPlan(planId: 'starter' | 'pro'): string {
  const priceId = planId === 'starter' ? env.STRIPE_PRICE_STARTER : env.STRIPE_PRICE_PRO;
  if (!priceId) throw new Error(`Billing is not configured (no Stripe price for plan "${planId}").`);
  return priceId;
}

/**
 * Find or create the Stripe Customer for a tenant, persisting the id so a
 * re-subscribe (e.g. after downgrading to free) reuses the same Customer
 * instead of creating a new one per checkout.
 */
async function ensureStripeCustomer(tenant: Tenant): Promise<string> {
  if (tenant.stripeCustomerId) return tenant.stripeCustomerId;

  const stripe = getStripeClient();
  const customer = await stripe.customers.create({
    name: tenant.businessName,
    metadata: { tenant_id: tenant.id },
  });

  const svc = createServiceClient();
  const { error } = await svc.from('tenants').update({ stripe_customer_id: customer.id }).eq('id', tenant.id);
  if (error) throw error;

  return customer.id;
}

/**
 * Create a Checkout Session for a tenant to subscribe to a paid plan
 * (docs/22 §2.2 — hosted, no custom card UI ever). `successUrl`/`cancelUrl`
 * are absolute URLs the caller builds from the request's own origin.
 */
export async function createCheckoutSession(args: {
  tenant: Tenant;
  planId: 'starter' | 'pro';
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string }> {
  const stripe = getStripeClient();
  const customerId = await ensureStripeCustomer(args.tenant);

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceIdForPlan(args.planId), quantity: 1 }],
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    // Read back on checkout.session.completed (docs/22 §2.3) so the webhook
    // knows which tenant to flip WITHOUT trusting anything from the client.
    client_reference_id: args.tenant.id,
    metadata: { tenant_id: args.tenant.id, plan_id: args.planId },
  });

  if (!session.url) throw new Error('Stripe did not return a Checkout URL.');
  return { url: session.url };
}

/**
 * Create a Customer Portal link for self-serve plan changes, payment method
 * updates, and cancellation (docs/22 §2.2 — hosted, no custom UI here either).
 */
export async function createPortalLink(args: { tenant: Tenant; returnUrl: string }): Promise<{ url: string }> {
  const stripe = getStripeClient();
  const customerId = await ensureStripeCustomer(args.tenant);

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: args.returnUrl,
  });

  return { url: session.url };
}

/** Re-exported so the webhook route can verify signatures without importing the `stripe` package twice. */
export function getStripeClientForWebhook(): Stripe {
  return getStripeClient();
}
