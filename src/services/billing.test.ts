import { describe, it, expect, vi } from 'vitest';

// services/billing and services/safepay both import `server-only` and `@/lib/env`,
// which throw outside a server/env context. Stub them so these stay pure unit
// tests of the routing + reference logic, not an env-provisioning test.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({
  env: {
    SAFEPAY_SECRET_KEY: undefined,
    SAFEPAY_WEBHOOK_SECRET: undefined,
    SAFEPAY_PLAN_STARTER: undefined,
    SAFEPAY_PLAN_GROWTH: undefined,
    SAFEPAY_PLAN_PRO: undefined,
    SAFEPAY_ENVIRONMENT: 'sandbox',
    SAFEPAY_USD_TO_PKR: 278,
    // Distinct values so the price→plan reverse lookup is a real test.
    STRIPE_PRICE_STARTER: 'price_starter_39',
    STRIPE_PRICE_GROWTH: 'price_growth_49',
    STRIPE_PRICE_PRO: 'price_pro_79',
  },
}));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }));

const { providerForCountry, providerForTenant, hasHostedPortal } = await import('./billing');
const { parseReference } = await import('./safepay');
import type { Tenant } from '@/types/domain';

/** Minimal Tenant stub — only the billing fields the router reads. */
function tenantWith(overrides: Partial<Tenant>): Tenant {
  return {
    billingProvider: 'stripe',
    billingCountry: null,
    safepayCustomerId: null,
    safepaySubscriptionId: null,
    safepayAmountMinor: null,
    safepayCurrency: null,
    ...overrides,
  } as Tenant;
}

describe('providerForCountry', () => {
  it('routes Pakistan to Safepay', () => {
    expect(providerForCountry('PK')).toBe('safepay');
  });

  it('is case-insensitive — a lowercase code must not silently fall through to Stripe', () => {
    expect(providerForCountry('pk')).toBe('safepay');
  });

  it('routes everything else to Stripe', () => {
    expect(providerForCountry('US')).toBe('stripe');
    expect(providerForCountry('GB')).toBe('stripe');
    expect(providerForCountry('AE')).toBe('stripe');
  });

  it('falls back to Stripe when country is unknown, rather than blocking checkout', () => {
    expect(providerForCountry(null)).toBe('stripe');
    expect(providerForCountry(undefined)).toBe('stripe');
    expect(providerForCountry('')).toBe('stripe');
  });
});

describe('providerForTenant', () => {
  it('uses the stored provider over the country', () => {
    // The important case: a tenant with a LIVE Safepay subscription whose
    // country was later edited must keep billing on Safepay. Re-routing them to
    // Stripe would orphan a subscription that is still charging them.
    const tenant = tenantWith({ billingProvider: 'safepay', billingCountry: 'US' });
    expect(providerForTenant(tenant)).toBe('safepay');
  });

  it('falls back to country when the stored provider is not recognised', () => {
    const tenant = tenantWith({ billingProvider: 'garbage' as never, billingCountry: 'PK' });
    expect(providerForTenant(tenant)).toBe('safepay');
  });

  it('defaults an unconfigured tenant to Stripe', () => {
    expect(providerForTenant(tenantWith({ billingProvider: 'stripe' }))).toBe('stripe');
  });
});

describe('hasHostedPortal', () => {
  it('is true only for Stripe — Safepay has no customer portal', () => {
    expect(hasHostedPortal(tenantWith({ billingProvider: 'stripe' }))).toBe(true);
    expect(hasHostedPortal(tenantWith({ billingProvider: 'safepay' }))).toBe(false);
  });
});

describe('parseReference', () => {
  it('round-trips a tenant id and plan, for every PAID tier', () => {
    // Safepay carries no metadata bag, so this string is the ONLY link from a
    // webhook back to a tenant. A parsing bug here means paid-but-not-upgraded.
    const uuid = 'cc3f2475-4fb1-4d80-99f8-3a582a496fa6';
    expect(parseReference(`${uuid}:starter`)).toEqual({ tenantId: uuid, planId: 'starter' });
    expect(parseReference(`${uuid}:growth`)).toEqual({ tenantId: uuid, planId: 'growth' });
    expect(parseReference(`${uuid}:pro`)).toEqual({ tenantId: uuid, planId: 'pro' });
  });

  it('rejects an unknown plan rather than guessing a tier', () => {
    expect(parseReference('some-tenant:enterprise')).toBeNull();
    // 'free' is a real plan id but is NOT purchasable — a webhook must never
    // be able to "grant" it through the paid-checkout path.
    expect(parseReference('some-tenant:free')).toBeNull();
  });

  it('rejects malformed or absent references', () => {
    expect(parseReference(null)).toBeNull();
    expect(parseReference(undefined)).toBeNull();
    expect(parseReference('')).toBeNull();
    expect(parseReference('no-colon')).toBeNull();
    expect(parseReference(':starter')).toBeNull();
  });
});

const { planForPriceId, priceIdForPlan } = await import('./stripe');

/**
 * The Customer Portal lets a tenant change tier WITHOUT touching our checkout,
 * and `customer.subscription.updated` carries only the new Price id. Without
 * this reverse mapping an upgrade charges the new amount while `tenants.plan`
 * keeps the old tier — and a downgrade leaves the tenant over-entitled.
 */
describe('planForPriceId — Stripe portal tier changes', () => {
  it('maps each configured price back to its plan', () => {
    expect(planForPriceId('price_starter_39')).toBe('starter');
    expect(planForPriceId('price_growth_49')).toBe('growth');
    expect(planForPriceId('price_pro_79')).toBe('pro');
  });

  it('round-trips against priceIdForPlan for every paid tier', () => {
    for (const plan of ['starter', 'growth', 'pro'] as const) {
      expect(planForPriceId(priceIdForPlan(plan))).toBe(plan);
    }
  });

  it('returns null for an unknown price rather than guessing a tier', () => {
    // A Price created by hand in the Stripe dashboard must never map onto a
    // tier by accident — the webhook leaves the plan alone and logs instead.
    expect(planForPriceId('price_made_up')).toBeNull();
    expect(planForPriceId(null)).toBeNull();
    expect(planForPriceId(undefined)).toBeNull();
    expect(planForPriceId('')).toBeNull();
  });
});
