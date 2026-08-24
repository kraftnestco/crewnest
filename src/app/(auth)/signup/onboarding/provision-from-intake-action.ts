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
import { isPlanId } from '@/lib/entitlements';
import { normalizeBillingCountry } from '@/lib/signup-country';
import { parseIntakeFormData, recordToIntakeForm } from '@/components/intake/parse-intake-form';
import { log } from '@/lib/log';

/**
 * Self-serve onboarding provisioner (docs: "try it for your business" plan,
 * Phase C — direct-signup path). The demo path keeps `provisionTenantAction`
 * (provisions from a stored `DemoTenantInput`); THIS action provisions from
 * the full intake wizard's `FormData`, so the booking config a service business
 * sets in the wizard actually lands on the new tenant — `DemoTenantInput` is a
 * subset that silently drops `booking_mode`/`booking_own_link`/durations/
 * `voice_handling`/`default_currency`, which the wizard collects.
 *
 * Same self-serve guarantees as `provisionTenantAction`: service-role writes
 * gated by the caller's own session, only ever links the CALLER's user id,
 * and refuses to spawn a second tenant for an account that already has one.
 */

export interface ProvisionFromIntakeResult {
  error: string | null;
  tenantId: string | null;
  planStatus: 'pending_upgrade' | null;
}

export async function provisionFromIntakeAction(input: {
  businessName: string;
  /**
   * The wizard's `FormData` flattened to a plain record on the client
   * (`formDataToRecord`) — a shape that safely serializes across the
   * server-action wire, unlike `FormData` itself. Repeated keys (e.g.
   * `payment_methods`) are arrays.
   */
  intakeFields: Record<string, string | string[]>;
  planId: string;
  billingCountry?: string | null;
}): Promise<ProvisionFromIntakeResult> {
  const ctx = await getCallerContext();
  if (!ctx) return { error: 'You need to be signed in to continue.', tenantId: null, planStatus: null };

  // Already provisioned (or an admin-invited client) — nothing to do, and
  // never spawn a second tenant for the same account.
  if (ctx.memberships.length > 0) {
    return { error: null, tenantId: ctx.memberships[0].tenantId, planStatus: null };
  }

  const businessName = input.businessName.trim();
  if (!businessName) {
    return { error: 'Enter your business name to continue.', tenantId: null, planStatus: null };
  }
  if (businessName.length > 120) {
    return { error: 'Business name is too long (max 120 characters).', tenantId: null, planStatus: null };
  }

  // Self-serve onboarding is never the platform-admin path (the page guard
  // redirects admins to /admin), so parse as the client path: freeform
  // catalogue text, no raw catalog_data JSON.
  const parsed = parseIntakeFormData(recordToIntakeForm(input.intakeFields), { isPlatformAdmin: false });
  if ('error' in parsed) {
    return { error: parsed.error, tenantId: null, planStatus: null };
  }

  const planId = isPlanId(input.planId) ? input.planId : 'free';
  const isFree = planId === 'free';

  const svc = createServiceClient();
  const { data: tenant, error: insertError } = await svc
    .from('tenants')
    .insert({
      business_name: businessName,
      system_prompt: parsed.systemPrompt,
      catalog_freeform_text: parsed.catalogFreeformText,
      // catalog_data is derived from the freeform text in `after()` below —
      // same pattern as provisionTenantAction, so the new user isn't kept
      // waiting on the catalogue parse.
      catalog_data: {},
      business_type: parsed.businessType,
      booking_link: parsed.bookingLink,
      booking_enabled: parsed.bookingEnabled,
      booking_mode: parsed.bookingMode,
      booking_own_link: parsed.bookingOwnLink,
      booking_duration_minutes: parsed.bookingDurationMinutes,
      booking_lead_time_minutes: parsed.bookingLeadTimeMinutes,
      booking_max_days_ahead: parsed.bookingMaxDaysAhead,
      custom_orders_enabled: parsed.customOrdersEnabled,
      custom_orders_require_approval: parsed.customOrdersRequireApproval,
      custom_order_instructions: parsed.customOrderInstructions,
      media_handling: parsed.mediaHandling,
      voice_handling: parsed.voiceHandling,
      knowledge_base: parsed.knowledgeBase,
      business_hours: parsed.businessHours,
      timezone: parsed.timezone,
      payments_enabled: parsed.paymentsEnabled,
      payment_methods: parsed.paymentMethods.length ? parsed.paymentMethods : ['cod'],
      payment_instructions: parsed.paymentInstructions,
      default_currency: parsed.defaultCurrency,
      prepaid_required: parsed.prepaidRequired,
      intake_completed_at: new Date().toISOString(),
      // ALWAYS provisioned on 'free', even when a paid tier was selected. The
      // billing webhook is the single writer of `tenants.plan` (see the Stripe
      // and Safepay routes); writing the SELECTED tier here granted its full
      // entitlements immediately, since `entitlementsFor()` reads `tenants.plan`
      // and never consults `plan_status`. `plan_status` records the intent so
      // the agency can follow up on an abandoned checkout, and the selected
      // tier round-trips through the provider itself (Stripe metadata.plan_id
      // / Safepay's `<tenantId>:<planId>` reference), not through this row.
      plan: 'free',
      plan_status: isFree ? null : 'pending_upgrade',
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
  // referrer's slug/id in the `cn_ref` cookie back on the landing page; record
  // it on the new tenant. Kept best-effort (logged, never fatal) so signup can
  // never break on attribution.
  try {
    const cookieStore = await cookies();
    const ref = cookieStore.get('cn_ref')?.value?.trim();
    if (ref) {
      const { error: refErr } = await svc.from('tenants').update({ referred_by: ref }).eq('id', tenant.id);
      if (refErr) log.warn('[onboarding] referral attribution failed to persist', { tenantId: tenant.id });
    }
  } catch (err) {
    log.warn('[onboarding] referral attribution failed', { tenantId: tenant.id, err });
  }

  if (!isFree) {
    await notify({
      scope: 'agency',
      tenantId: tenant.id,
      type: 'upgrade_request',
      title: `${businessName} wants to upgrade to ${planId}`,
      body: `Signed up via self-serve onboarding and selected the ${planId} plan — reach out to activate billing.`,
      entityType: 'tenant',
      entityId: tenant.id,
      link: `/admin/clients/${tenant.id}`,
    });
  }

  // Same re-embed pattern as provisionTenantAction: derive catalog_data from
  // the freeform text and index it, without blocking the response the new
  // user is waiting on.
  after(async () => {
    if (!parsed.catalogFreeformText?.trim()) return;
    const full = await tenantsService.getById(tenant.id);
    if (!full) return;
    try {
      const catalogData = await parseCatalogueFreeform(full, parsed.catalogFreeformText);
      await svc.from('tenants').update({ catalog_data: catalogData }).eq('id', tenant.id);
      await ingestTenantKnowledge(full, catalogData, parsed.knowledgeBase);
    } catch (err) {
      log.error('[onboarding] post-provision catalogue enrichment failed', { tenantId: tenant.id, err });
    }
  });

  revalidatePath('/dashboard');
  return { error: null, tenantId: tenant.id, planStatus: isFree ? null : 'pending_upgrade' };
}
