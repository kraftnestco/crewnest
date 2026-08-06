'use server';

import { assertTenantAccess, getCallerContext } from '@/lib/auth/context';
import * as tenants from '@/services/tenants';
import { createPortalLink } from '@/services/stripe';
import { cancelSubscription } from '@/services/safepay';
import { createCheckout, hasHostedPortal, providerForTenant } from '@/services/billing';
import { isPaidPlanId, type PaidPlanId } from '@/lib/entitlements';
import { env } from '@/lib/env';
import { log } from '@/lib/log';

/**
 * Billing server actions (docs/22-BILLING-STRIPE.md §4). Tenant-admin gated —
 * same shape as requireTenantAdmin in dashboard/business/copilot-actions.ts —
 * because billing is money, same bar as editing business settings, stricter
 * than a plain tenant_agent's read/reply access.
 */

async function requireTenantAdmin(tenantId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getCallerContext();
  if (!ctx) return { ok: false, error: 'Unauthorized.' };
  try {
    assertTenantAccess(ctx, tenantId);
  } catch {
    return { ok: false, error: 'Forbidden: tenant not accessible.' };
  }
  if (!ctx.isPlatformAdmin && !ctx.memberships.some((m) => m.tenantId === tenantId && m.role === 'tenant_admin')) {
    return { ok: false, error: 'Forbidden: only a tenant admin may manage billing.' };
  }
  return { ok: true };
}

export interface BillingActionResult {
  url: string | null;
  error: string | null;
}

export async function createCheckoutSessionAction(
  tenantId: string,
  planId: PaidPlanId,
): Promise<BillingActionResult> {
  const gate = await requireTenantAdmin(tenantId);
  if (!gate.ok) return { url: null, error: gate.error };

  // The PaidPlanId type is erased at runtime, so this is a real check, not a
  // formality: `planId` arrives from the client and decides which price gets
  // charged. An unknown or 'free' value must never reach the provider.
  if (!isPaidPlanId(planId)) return { url: null, error: 'Unknown plan.' };

  const tenant = await tenants.getById(tenantId);
  if (!tenant) return { url: null, error: 'Tenant not found.' };

  try {
    const base = env.NEXT_PUBLIC_APP_URL;
    // Routed by provider (docs/25 §2) — Stripe or Safepay depending on the
    // tenant's billing country. Both return a hosted URL to redirect to.
    const { url } = await createCheckout({
      tenant,
      planId,
      successUrl: `${base}/dashboard/billing?checkout=success`,
      cancelUrl: `${base}/dashboard/billing?checkout=cancelled`,
    });
    return { url, error: null };
  } catch (err) {
    log.error('[billing] checkout session creation failed', {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { url: null, error: "Couldn't start checkout. Please try again." };
  }
}

export async function createPortalLinkAction(tenantId: string): Promise<BillingActionResult> {
  const gate = await requireTenantAdmin(tenantId);
  if (!gate.ok) return { url: null, error: gate.error };

  const tenant = await tenants.getById(tenantId);
  if (!tenant) return { url: null, error: 'Tenant not found.' };

  // Safepay has no hosted customer portal (services/safepay.ts §3). Rather than
  // fake one, Safepay tenants manage their subscription in-app via
  // cancelSubscriptionAction below — the UI hides this button for them, and
  // this guard makes the server side refuse rather than throw an opaque error.
  if (!hasHostedPortal(tenant)) {
    return { url: null, error: 'Billing management is handled in-app for this account.' };
  }

  try {
    const { url } = await createPortalLink({
      tenant,
      returnUrl: `${env.NEXT_PUBLIC_APP_URL}/dashboard/billing`,
    });
    return { url, error: null };
  } catch (err) {
    log.error('[billing] portal link creation failed', {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { url: null, error: "Couldn't open billing management. Please try again." };
  }
}

export interface CancelActionResult {
  ok: boolean;
  error: string | null;
}

/**
 * Cancel a Safepay subscription (docs/25 §3.3). Stripe tenants cancel through
 * the hosted portal instead, so this refuses for them rather than duplicating
 * that path.
 *
 * Requests cancellation only — the actual downgrade lands via the webhook, so
 * `tenants.plan` keeps its single writer and a failed cancel can never leave a
 * tenant downgraded while still being charged.
 */
export async function cancelSubscriptionAction(tenantId: string): Promise<CancelActionResult> {
  const gate = await requireTenantAdmin(tenantId);
  if (!gate.ok) return { ok: false, error: gate.error };

  const tenant = await tenants.getById(tenantId);
  if (!tenant) return { ok: false, error: 'Tenant not found.' };

  if (providerForTenant(tenant) !== 'safepay') {
    return { ok: false, error: 'Use “Manage billing” to cancel this subscription.' };
  }
  if (!tenant.safepaySubscriptionId) {
    return { ok: false, error: 'No active subscription to cancel.' };
  }

  try {
    await cancelSubscription(tenant);
    return { ok: true, error: null };
  } catch (err) {
    log.error('[billing] safepay cancellation failed', {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "Couldn't cancel your subscription. Please try again." };
  }
}
