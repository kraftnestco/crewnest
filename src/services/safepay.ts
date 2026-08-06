import 'server-only';
import { Safepay } from '@sfpy/node-sdk';
import { Environment } from '@sfpy/node-sdk/dist/utils';
import { env } from '@/lib/env';
import { createServiceClient } from '@/lib/supabase/service';
import type { Tenant } from '@/types/domain';
import { isPaidPlanId, type PaidPlanId } from '@/lib/entitlements';

/**
 * Safepay wrapper (docs/25-BILLING-SAFEPAY.md). The Pakistan-side counterpart
 * to services/stripe.ts, and deliberately the same shape: thin, talks only TO
 * Safepay, and NEVER writes tenants.plan/plan_status — that stays the webhook's
 * exclusive job (api/webhooks/safepay/route.ts), exactly as with Stripe.
 *
 * WHY A SECOND PROVIDER: Stripe does not onboard Pakistan-based merchants, so
 * a PKR-settling provider is the only way to charge Pakistani tenants at all.
 *
 * Same "no silent no-op" posture as Stripe (docs/22 §4): a paywall that appears
 * to work but never charges is worse than a loud error, so callers throw when
 * Safepay is unconfigured rather than returning null.
 *
 * ── Three ways Safepay genuinely differs from Stripe, which shape this file ──
 *
 * 1. NO CUSTOMER OBJECT. Safepay has no `customers.create`, so there is no
 *    equivalent of ensureStripeCustomer. A subscription is tied to our own
 *    `reference` string instead — we send the tenant id, and the webhook reads
 *    it back to know which tenant to flip. `safepay_customer_id` is therefore
 *    populated from the subscription payload when Safepay reports one, not
 *    minted up-front by us.
 *
 * 2. THE PLAN CARRIES THE PRICE. `createSubscription` accepts only a planId —
 *    there is no per-checkout amount parameter. Amount, currency and interval
 *    all live on the plan you create in Safepay's merchant dashboard. This is
 *    why prices are fixed PKR plan amounts and NOT a USD figure converted at
 *    checkout: the API has nowhere to put a converted amount. See §3.2.
 *
 * 3. NO HOSTED CUSTOMER PORTAL. Stripe's billingPortal has no counterpart;
 *    Safepay exposes cancel/pause/resume as API calls. So "Manage billing" for
 *    a Safepay tenant is our own in-app cancel action, not an external link.
 */

let safepayClient: Safepay | null = null;

function getSafepayClient(): Safepay {
  if (safepayClient) return safepayClient;
  if (!env.SAFEPAY_SECRET_KEY) {
    throw new Error('Billing is not configured (SAFEPAY_SECRET_KEY unset).');
  }
  if (!env.SAFEPAY_WEBHOOK_SECRET) {
    // Refused up-front rather than at webhook time: a subscription created
    // without a verifiable webhook path would take money we could never
    // confirm, leaving the tenant paid-but-not-upgraded.
    throw new Error('Billing is not configured (SAFEPAY_WEBHOOK_SECRET unset).');
  }
  safepayClient = new Safepay({
    environment:
      env.SAFEPAY_ENVIRONMENT === 'production' ? Environment.Production : Environment.Sandbox,
    apiKey: env.SAFEPAY_SECRET_KEY,
    // The SDK uses v1Secret for redirect-signature checks and webhookSecret for
    // webhook HMACs — two different secrets in Safepay's model. We only consume
    // the webhook path, so both are fed the same configured value.
    v1Secret: env.SAFEPAY_WEBHOOK_SECRET,
    webhookSecret: env.SAFEPAY_WEBHOOK_SECRET,
  });
  return safepayClient;
}

/**
 * `PAYWALL_PLANS.id` → the Safepay Plan id to subscribe to (docs/25 §3).
 *
 * Exhaustive over `PaidPlanId` — adding a tier without wiring its plan id here
 * is a compile error, not a failed checkout.
 */
const SAFEPAY_PLAN_ENV: Record<PaidPlanId, () => string | undefined> = {
  starter: () => env.SAFEPAY_PLAN_STARTER,
  growth: () => env.SAFEPAY_PLAN_GROWTH,
  pro: () => env.SAFEPAY_PLAN_PRO,
};

export function planIdForPlan(planId: PaidPlanId): string {
  const id = SAFEPAY_PLAN_ENV[planId]();
  if (!id) throw new Error(`Billing is not configured (no Safepay plan for plan "${planId}").`);
  return id;
}

/**
 * Create a hosted subscription checkout link (docs/25 §3.1 — hosted only, no
 * custom card UI, same rule as Stripe).
 *
 * `reference` is the tenant id. It is the ONLY link back to the tenant, since
 * Safepay has no customer object and no metadata bag — the webhook resolves the
 * tenant from it. It is server-set here and never accepted from the client.
 */
export async function createSubscriptionCheckout(args: {
  tenant: Tenant;
  planId: PaidPlanId;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string }> {
  const safepay = getSafepayClient();

  const url = await safepay.checkout.createSubscription({
    planId: planIdForPlan(args.planId),
    reference: buildReference(args.tenant.id, args.planId),
    redirectUrl: args.successUrl,
    cancelUrl: args.cancelUrl,
  });

  if (!url) throw new Error('Safepay did not return a subscription checkout URL.');
  return { url };
}

/**
 * Cancel a tenant's Safepay subscription.
 *
 * Note the asymmetry with Stripe: this only ASKS Safepay to cancel. The plan is
 * still downgraded by the webhook when Safepay confirms, so the single-writer
 * rule holds and a failed cancellation can never leave a tenant downgraded but
 * still being charged.
 */
export async function cancelSubscription(tenant: Tenant): Promise<void> {
  if (!tenant.safepaySubscriptionId) {
    throw new Error('This tenant has no active Safepay subscription to cancel.');
  }
  const safepay = getSafepayClient();
  await safepay.subscription.cancel(tenant.safepaySubscriptionId);
}

/**
 * `reference` round-trips the tenant id AND the plan through Safepay, because
 * the webhook payload carries no other way to know which tier was bought.
 * Format: `<tenantId>:<planId>`. Parsed by parseReference below.
 */
function buildReference(tenantId: string, planId: PaidPlanId): string {
  return `${tenantId}:${planId}`;
}

/**
 * Inverse of buildReference. Returns null on anything malformed — never guesses.
 *
 * Validates the plan against the PAID plan allow-list, so a webhook can never
 * grant a tier that doesn't exist (or 'free', which isn't purchasable).
 */
export function parseReference(reference: string | null | undefined): {
  tenantId: string;
  planId: PaidPlanId;
} | null {
  if (!reference) return null;
  const [tenantId, planId] = reference.split(':');
  if (!tenantId || !planId || !isPaidPlanId(planId)) return null;
  return { tenantId, planId };
}

/** Persist the Safepay ids/amount observed on a confirmed subscription (webhook-only writer). */
export async function persistSubscriptionIds(args: {
  tenantId: string;
  subscriptionId: string | null;
  customerId: string | null;
  amountMinor: number | null;
  currency: string | null;
}): Promise<void> {
  const svc = createServiceClient();
  const { error } = await svc
    .from('tenants')
    .update({
      safepay_subscription_id: args.subscriptionId,
      safepay_customer_id: args.customerId,
      safepay_amount_minor: args.amountMinor,
      safepay_currency: args.currency,
    })
    .eq('id', args.tenantId);
  if (error) throw error;
}

/** Re-exported so the webhook route can verify signatures without constructing a second client. */
export function getSafepayClientForWebhook(): Safepay {
  return getSafepayClient();
}
