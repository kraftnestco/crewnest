'use server';

import { assertTenantAccess, getCallerContext } from '@/lib/auth/context';
import * as tenants from '@/services/tenants';
import { createCheckoutSession, createPortalLink } from '@/services/stripe';
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
  planId: 'starter' | 'pro',
): Promise<BillingActionResult> {
  const gate = await requireTenantAdmin(tenantId);
  if (!gate.ok) return { url: null, error: gate.error };

  const tenant = await tenants.getById(tenantId);
  if (!tenant) return { url: null, error: 'Tenant not found.' };

  try {
    const base = env.NEXT_PUBLIC_APP_URL;
    const { url } = await createCheckoutSession({
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
