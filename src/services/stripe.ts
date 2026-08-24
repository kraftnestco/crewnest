import 'server-only';
import Stripe from 'stripe';
import { env } from '@/lib/env';
import { createServiceClient } from '@/lib/supabase/service';
import type { Tenant } from '@/types/domain';
import { PAID_PLAN_IDS, type PaidPlanId } from '@/lib/entitlements';

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

/**
 * `PAYWALL_PLANS.id` → the Stripe Price id to subscribe to (docs/22 §4).
 *
 * Exhaustive over `PaidPlanId`, so adding a tier to lib/entitlements.ts without
 * wiring its price here is a compile error rather than a runtime surprise at
 * someone's checkout.
 */
const STRIPE_PRICE_ENV: Record<PaidPlanId, () => string | undefined> = {
  starter: () => env.STRIPE_PRICE_STARTER,
  growth: () => env.STRIPE_PRICE_GROWTH,
  pro: () => env.STRIPE_PRICE_PRO,
  enterprise: () => env.STRIPE_PRICE_ENTERPRISE,
};

export function priceIdForPlan(planId: PaidPlanId): string {
  const priceId = STRIPE_PRICE_ENV[planId]();
  if (!priceId) throw new Error(`Billing is not configured (no Stripe price for plan "${planId}").`);
  return priceId;
}

/**
 * Reverse of `priceIdForPlan`: which plan does this Stripe Price belong to?
 *
 * Needed because the Customer Portal lets a tenant CHANGE TIER without going
 * through our checkout — the only signal is a `customer.subscription.updated`
 * carrying the new price. Without this mapping an upgrade through the portal
 * charges the new amount while `tenants.plan` silently keeps the old tier (and
 * a downgrade leaves them over-entitled).
 *
 * Returns null for an unrecognised price, so a Price created directly in the
 * Stripe dashboard can never map onto a tier by accident.
 */
export function planForPriceId(priceId: string | null | undefined): PaidPlanId | null {
  if (!priceId) return null;
  for (const plan of PAID_PLAN_IDS) {
    if (STRIPE_PRICE_ENV[plan]() === priceId) return plan;
  }
  return null;
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
  planId: PaidPlanId;
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
