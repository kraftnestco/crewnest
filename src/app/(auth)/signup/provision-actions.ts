'use server';

import { after } from 'next/server';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getCallerContext } from '@/lib/auth/context';
import { createServiceClient } from '@/lib/supabase/service';
import { notify } from '@/services/notifications';
import { parseCatalogueFreeform } from '@/services/ai/catalogueParser';
import { ingestTenantKnowledge } from '@/services/knowledge';
import * as tenantsService from '@/services/tenants';
import type { DemoTenantInput } from '@/services/demo/schema';
import { isPaidPlanId, isPlanId } from '@/lib/entitlements';
import { normalizeBillingCountry } from '@/lib/signup-country';
import type { Json } from '@/types/database';
import { log } from '@/lib/log';

/**
 * Provisions a real tenant from the demo's stored intake, right after a
 * visitor creates an account (docs: "try it for your business" plan, Phase C).
 * Service-role writes gated in-body by the caller's own session — mirrors
 * admin/clients/[id]/invite/actions.ts's pattern, but self-serve: this only
 * ever links the CALLER's own user id, never an admin-supplied one, and
 * refuses to run at all for a caller who already has a tenant.
 */

export interface ProvisionTenantResult {
  error: string | null;
  tenantId: string | null;
  planStatus: 'pending_upgrade' | null;
}

// Plan allow-list comes from lib/entitlements.ts. A local copy here silently
// downgraded any newly added tier to 'free' at signup — the user picks Growth,
// pays nothing, and lands on the free plan with no error anywhere.

export async function provisionTenantAction(input: {
  demoTenant: DemoTenantInput;
  planId: string;
  billingCountry?: string | null;
}): Promise<ProvisionTenantResult> {
  const ctx = await getCallerContext();
  if (!ctx) return { error: 'You need to be signed in to continue.', tenantId: null, planStatus: null };

  // Already provisioned (or an admin-invited client) — nothing to do, and
  // never spawn a second tenant for the same account.
  if (ctx.memberships.length > 0) {
    return { error: null, tenantId: ctx.memberships[0].tenantId, planStatus: null };
  }

  const { demoTenant } = input;
  // Enterprise is sales-led — never treat it as a self-serve pending upgrade.
  const requested = isPlanId(input.planId) ? input.planId : 'free';
  const planId = isPaidPlanId(requested) || requested === 'free' ? requested : 'free';
  const isSelfServePaid = isPaidPlanId(planId);

  const svc = createServiceClient();
  const { data: tenant, error: insertError } = await svc
    .from('tenants')
    .insert({
      business_name: demoTenant.businessName,
      system_prompt: demoTenant.systemPrompt,
      catalog_freeform_text: demoTenant.catalogFreeformText,
      business_type: demoTenant.businessType,
      booking_link: demoTenant.bookingLink,
      custom_orders_enabled: demoTenant.customOrdersEnabled,
      custom_orders_require_approval: demoTenant.customOrdersRequireApproval,
      custom_order_instructions: demoTenant.customOrderInstructions,
      media_handling: demoTenant.mediaHandling,
      knowledge_base: demoTenant.knowledgeBase as unknown as Json,
      business_hours: demoTenant.businessHours as unknown as Json,
      timezone: demoTenant.timezone,
      payments_enabled: demoTenant.paymentsEnabled,
      payment_methods: demoTenant.paymentMethods,
      payment_instructions: demoTenant.paymentInstructions,
      intake_completed_at: new Date().toISOString(),
      // ALWAYS provisioned on 'free', even when a paid tier was selected. The
      // billing webhook is the single writer of `tenants.plan` (see the Stripe
      // and Safepay routes), and it is the only thing that can confirm money
      // actually moved. Writing the SELECTED tier here granted its full
      // entitlements immediately: `entitlementsFor()` reads `tenants.plan` and
      // never consults `plan_status`, so a visitor could pick Pro, abandon the
      // client-side redirect to checkout, and keep unlimited conversations,
      // unlimited channels and the Copilot for free, forever, with nothing to
      // reconcile it. `plan_status` still records the intent so the agency can
      // follow up on an abandoned checkout, and the selected tier round-trips
      // through the provider itself (Stripe metadata.plan_id /
      // Safepay's `<tenantId>:<planId>` reference), not through this row.
      plan: 'free',
      plan_status: isSelfServePaid ? 'pending_upgrade' : null,
      billing_country: normalizeBillingCountry(input.billingCountry),
    })
    .select('id')
    .single();

  if (insertError || !tenant) {
    return { error: insertError?.message ?? 'Failed to create your account.', tenantId: null, planStatus: null };
  }

  const { error: linkError } = await svc
    .from('user_tenants')
    .upsert({ user_id: ctx.userId, tenant_id: tenant.id, role: 'tenant_admin' }, { onConflict: 'user_id,tenant_id' });

  if (linkError) {
    return { error: linkError.message, tenantId: tenant.id, planStatus: null };
  }

  // Referral attribution (docs/19 G1) — best-effort. `RefCapture` stashed the
  // referrer's slug/id in the `cn_ref` cookie back on the landing page; record it
  // on the new tenant. Kept best-effort (logged, never fatal) so signup can never
  // break on attribution.
  try {
    const cookieStore = await cookies();
    const ref = cookieStore.get('cn_ref')?.value?.trim();
    if (ref) {
      const { error: refErr } = await svc
        .from('tenants')
        .update({ referred_by: ref })
        .eq('id', tenant.id);
      if (refErr) log.warn('[signup] referral attribution failed to persist', { tenantId: tenant.id });
    }
  } catch (err) {
    log.warn('[signup] referral attribution failed', { tenantId: tenant.id, err });
  }

  if (isSelfServePaid) {
    await notify({
      scope: 'agency',
      tenantId: tenant.id,
      type: 'upgrade_request',
      title: `${demoTenant.businessName} wants to upgrade to ${planId}`,
      body: `Signed up via the free demo and selected the ${planId} plan — reach out to activate billing.`,
      entityType: 'tenant',
      entityId: tenant.id,
      link: `/admin/clients/${tenant.id}`,
    });
  }

  // Same re-embed pattern as updateIntakeAction's client path: derive
  // catalog_data from the freeform text and index it, without blocking the
  // response the new user is waiting on.
  after(async () => {
    if (!demoTenant.catalogFreeformText.trim()) return;
    const full = await tenantsService.getById(tenant.id);
    if (!full) return;
    try {
      const catalogData = await parseCatalogueFreeform(full, demoTenant.catalogFreeformText);
      await svc.from('tenants').update({ catalog_data: catalogData }).eq('id', tenant.id);
      await ingestTenantKnowledge(full, catalogData, demoTenant.knowledgeBase);
    } catch (err) {
      log.error('[signup] post-provision catalogue enrichment failed', { tenantId: tenant.id, err });
    }
  });

  revalidatePath('/dashboard');
  return { error: null, tenantId: tenant.id, planStatus: isSelfServePaid ? 'pending_upgrade' : null };
}
