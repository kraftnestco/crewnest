import 'server-only';
import type { BillingProviderId, Tenant } from '@/types/domain';
import type { PaidPlanId } from '@/lib/entitlements';
import * as stripe from '@/services/stripe';
import * as safepay from '@/services/safepay';

/**
 * Billing provider routing (docs/25 §2).
 *
 * The single place that answers "which provider charges this tenant?", so the
 * server actions and UI never branch on it themselves. Deliberately a thin
 * router rather than a full `BillingProvider` interface with two adapters: the
 * two providers are genuinely NOT substitutable — Safepay has no customer
 * object and no hosted portal (see services/safepay.ts) — and a uniform
 * interface would have had to invent a fake portal for Safepay or drop the real
 * one from Stripe. An honest router that admits the difference beats an
 * abstraction that lies about it.
 *
 * ROUTING IS BY COUNTRY, NOT TENANT CHOICE: Stripe cannot onboard Pakistani
 * merchants and Safepay cannot practically serve international cards, so
 * letting a tenant pick would mean letting them pick a provider that then
 * declines their card, with no way to self-diagnose.
 */

/** Countries billed through Safepay. Everything else falls through to Stripe. */
const SAFEPAY_COUNTRIES = new Set(['PK']);

/**
 * The provider a tenant should transact on.
 *
 * Prefers the stored `billingProvider` — once a tenant has subscribed, the
 * provider holding their live subscription is authoritative, and must NOT
 * change under them just because a country field was edited later.
 * `billingCountry` only decides the case where nothing is stored yet.
 */
export function providerForTenant(tenant: Tenant): BillingProviderId {
  if (tenant.billingProvider === 'safepay' || tenant.billingProvider === 'stripe') {
    return tenant.billingProvider;
  }
  return providerForCountry(tenant.billingCountry);
}

/** Provider implied by a country code alone (used at signup, before a tenant row exists). */
export function providerForCountry(country: string | null | undefined): BillingProviderId {
  if (!country) return 'stripe';
  return SAFEPAY_COUNTRIES.has(country.toUpperCase()) ? 'safepay' : 'stripe';
}

/** True when this tenant manages their subscription via an external hosted portal (Stripe only). */
export function hasHostedPortal(tenant: Tenant): boolean {
  return providerForTenant(tenant) === 'stripe';
}

/**
 * Start a hosted subscription checkout on whichever provider serves this tenant.
 * Both providers return a URL the caller redirects the browser to; neither
 * changes plan state here — that is the webhook's job on both sides.
 */
export async function createCheckout(args: {
  tenant: Tenant;
  planId: PaidPlanId;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string }> {
  if (providerForTenant(args.tenant) === 'safepay') {
    return safepay.createSubscriptionCheckout(args);
  }
  return stripe.createCheckoutSession(args);
}
