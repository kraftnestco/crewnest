'use server';

import { after } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getCallerContext } from '@/lib/auth/context';
import { createServiceClient } from '@/lib/supabase/service';
import { notify } from '@/services/notifications';
import { parseCatalogueFreeform } from '@/services/ai/catalogueParser';
import { ingestTenantKnowledge } from '@/services/knowledge';
import * as tenantsService from '@/services/tenants';
import type { DemoTenantInput } from '@/services/demo/schema';
import type { Json } from '@/types/database';

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

const PLAN_IDS = ['free', 'starter', 'pro'] as const;

export async function provisionTenantAction(input: {
  demoTenant: DemoTenantInput;
  planId: string;
}): Promise<ProvisionTenantResult> {
  const ctx = await getCallerContext();
  if (!ctx) return { error: 'You need to be signed in to continue.', tenantId: null, planStatus: null };

  // Already provisioned (or an admin-invited client) — nothing to do, and
  // never spawn a second tenant for the same account.
  if (ctx.memberships.length > 0) {
    return { error: null, tenantId: ctx.memberships[0].tenantId, planStatus: null };
  }

  const { demoTenant } = input;
  const planId = (PLAN_IDS as readonly string[]).includes(input.planId) ? input.planId : 'free';
  const isFree = planId === 'free';

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
      plan: planId,
      plan_status: isFree ? null : 'pending_upgrade',
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

  if (!isFree) {
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
      console.error('[signup] post-provision catalogue enrichment failed', { tenantId: tenant.id, err });
    }
  });

  revalidatePath('/dashboard');
  return { error: null, tenantId: tenant.id, planStatus: isFree ? null : 'pending_upgrade' };
}
