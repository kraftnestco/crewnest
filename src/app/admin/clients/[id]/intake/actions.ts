'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { assertTenantAccess, getCallerContext } from '@/lib/auth/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import * as tenants from '@/services/tenants';
import { ingestTenantKnowledge } from '@/services/knowledge';
import { parseCatalogueFreeform } from '@/services/ai/catalogueParser';
import { composeSystemPrompt } from '@/services/ai/promptArchitect';
import { magicImportFromUrl } from '@/services/ai/magicImport';
import type { Json } from '@/types/database';
import type {
  GenerateSystemPromptResult,
  MagicImportResult,
  PromptArchitectFields,
} from '@/components/intake/intake-shared';
import { parseIntakeFormData } from '@/components/intake/parse-intake-form';
import type { UpdateIntakeState } from './intake-state';
import { log } from '@/lib/log';

/**
 * Writes the Stage-E intake wizard fields (docs/10-CUSTOM-ORDERS-MEDIA-AND-INTAKE.md §3.1).
 * Agency-operated today; the same action becomes the client's self-serve save
 * once Phase-2 client logins land — no rewrite (docs/10 §9).
 */

/**
 * Prompt Architect (docs/19 O1). Called imperatively from the intake UI to
 * compose a persona `system_prompt` from the owner's guided answers. Same
 * tenant-scoped auth as the save action; the tenant record supplies the business
 * name so the client never has to. Read-only w.r.t. tenant data — only writes a
 * usage_logs row (inside composeSystemPrompt) — so nothing to revalidate.
 */
export async function generateSystemPromptAction(
  tenantId: string,
  fields: PromptArchitectFields,
): Promise<GenerateSystemPromptResult> {
  const ctx = await getCallerContext();
  if (!ctx) return { prompt: null, error: 'Unauthorized.' };
  try {
    assertTenantAccess(ctx, tenantId);
  } catch {
    return { prompt: null, error: 'Forbidden: tenant not accessible.' };
  }
  if (!ctx.isPlatformAdmin && !ctx.memberships.some((m) => m.tenantId === tenantId && m.role === 'tenant_admin')) {
    return { prompt: null, error: 'Forbidden: only a tenant admin may edit business settings.' };
  }

  const tenant = await tenants.getById(tenantId);
  if (!tenant) return { prompt: null, error: 'Tenant not found.' };

  try {
    const prompt = await composeSystemPrompt(tenant, {
      businessName: tenant.businessName,
      businessType: fields.businessType === 'service' ? 'service' : 'product',
      businessSummary: fields.businessSummary,
      tone: fields.tone,
      boundaries: fields.boundaries,
      catalogueHint: fields.catalogueHint,
    });
    return { prompt, error: null };
  } catch (err) {
    log.error('[intake] prompt architect failed', { tenantId, err });
    return { prompt: null, error: "Couldn't write the instructions. Please try again, or write them yourself." };
  }
}

/**
 * Magic Import (docs/19 O2). Fetches the owner's website/social URL server-side
 * and returns a draft profile that the intake UI overlays for one-click confirm.
 * Same tenant-scoped auth as the save action. Read-only w.r.t. tenant data (only
 * writes usage_logs inside magicImportFromUrl), so nothing to revalidate. Never
 * persists — the owner reviews and the existing save is the only write.
 */
export async function importFromUrlAction(tenantId: string, rawUrl: string): Promise<MagicImportResult> {
  const ctx = await getCallerContext();
  if (!ctx) return { fields: null, summary: null, error: 'Unauthorized.' };
  try {
    assertTenantAccess(ctx, tenantId);
  } catch {
    return { fields: null, summary: null, error: 'Forbidden: tenant not accessible.' };
  }
  if (!ctx.isPlatformAdmin && !ctx.memberships.some((m) => m.tenantId === tenantId && m.role === 'tenant_admin')) {
    return { fields: null, summary: null, error: 'Forbidden: only a tenant admin may edit business settings.' };
  }

  const url = rawUrl.trim();
  if (!url) return { fields: null, summary: null, error: 'Paste your website or social page link first.' };

  const tenant = await tenants.getById(tenantId);
  if (!tenant) return { fields: null, summary: null, error: 'Tenant not found.' };

  try {
    const { fields, summary } = await magicImportFromUrl(tenant, url);
    return { fields, summary, error: null };
  } catch (err) {
    log.error('[intake] magic import failed', { tenantId, err });
    // The service throws Error objects with owner-friendly messages (bad URL,
    // unreachable, unreadable page). Surface those; fall back to generic otherwise.
    const message =
      err instanceof Error && err.message && err.message.length <= 200
        ? err.message
        : "We couldn't read that link. Check it opens in a browser, or fill in the steps yourself.";
    return { fields: null, summary: null, error: message };
  }
}

export async function updateIntakeAction(
  tenantId: string,
  _prev: UpdateIntakeState,
  formData: FormData,
): Promise<UpdateIntakeState> {
  const ctx = await getCallerContext();
  if (!ctx) return { error: 'Unauthorized.', success: false };
  try {
    assertTenantAccess(ctx, tenantId);
  } catch {
    return { error: 'Forbidden: tenant not accessible.', success: false };
  }
  if (!ctx.isPlatformAdmin && !ctx.memberships.some((m) => m.tenantId === tenantId && m.role === 'tenant_admin')) {
    return { error: 'Forbidden: only a tenant admin may edit business settings.', success: false };
  }

  // Field parsing is shared with self-serve onboarding's provision action
  // (parse-intake-form.ts) so the two can't drift on an allow-list.
  const parsed = parseIntakeFormData(formData, { isPlatformAdmin: ctx.isPlatformAdmin });
  if ('error' in parsed) return { error: parsed.error, success: false };

  // Admins edit catalog_data as raw JSON directly; clients describe their
  // catalogue in plain language and we derive the JSON the AI actually reads
  // (docs/13 §9 follow-up — clients are non-technical, JSON stays admin-only).
  let catalogData: Json = {};
  if (ctx.isPlatformAdmin) {
    catalogData = parsed.catalogDataAdmin ?? {};
  } else if (parsed.catalogFreeformText) {
    const tenant = await tenants.getById(tenantId);
    if (!tenant) return { error: 'Tenant not found.', success: false };
    try {
      catalogData = await parseCatalogueFreeform(tenant, parsed.catalogFreeformText);
    } catch {
      return { error: "Couldn't process your catalogue text. Please try again.", success: false };
    }
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('tenants')
    .update({
      system_prompt: parsed.systemPrompt,
      catalog_data: catalogData,
      custom_order_instructions: parsed.customOrderInstructions,
      media_handling: parsed.mediaHandling,
      voice_handling: parsed.voiceHandling,
      custom_orders_enabled: parsed.customOrdersEnabled,
      custom_orders_require_approval: parsed.customOrdersRequireApproval,
      business_type: parsed.businessType,
      booking_link: parsed.bookingLink,
      booking_enabled: parsed.bookingEnabled,
      booking_mode: parsed.bookingMode,
      booking_own_link: parsed.bookingOwnLink,
      booking_duration_minutes: parsed.bookingDurationMinutes,
      booking_lead_time_minutes: parsed.bookingLeadTimeMinutes,
      booking_max_days_ahead: parsed.bookingMaxDaysAhead,
      knowledge_base: parsed.knowledgeBase,
      business_hours: parsed.businessHours,
      timezone: parsed.timezone,
      payments_enabled: parsed.paymentsEnabled,
      payment_methods: parsed.paymentMethods.length ? parsed.paymentMethods : ['cod'],
      payment_instructions: parsed.paymentInstructions,
      default_currency: parsed.defaultCurrency,
      prepaid_required: parsed.prepaidRequired,
      // Only set on the client path — an admin's JSON save must never wipe
      // the client's stored freeform text back to null. Same reasoning for
      // intake_completed_at: only the client's own wizard save marks it done
      // (docs: "try it for your business" plan, Phase A).
      ...(ctx.isPlatformAdmin
        ? {}
        : { catalog_freeform_text: parsed.catalogFreeformText, intake_completed_at: new Date().toISOString() }),
    })
    .eq('id', tenantId);

  if (error) return { error: error.message, success: false };

  // Stage-N re-embed (docs/12 §5.2) — runs after the response so it never blocks
  // the save; best-effort, logged rather than surfaced to the agency user.
  after(async () => {
    const tenant = await tenants.getById(tenantId);
    if (!tenant) return;
    try {
      await ingestTenantKnowledge(tenant, catalogData, parsed.knowledgeBase);
    } catch (err) {
      log.error('[intake] knowledge re-embed failed', { tenantId, err });
    }
  });

  revalidatePath('/admin/clients');
  revalidatePath(`/admin/clients/${tenantId}/intake`);
  revalidatePath('/dashboard/business');
  return { error: null, success: true };
}
