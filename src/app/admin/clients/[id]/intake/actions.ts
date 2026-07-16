'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import * as tenants from '@/services/tenants';
import { ingestTenantKnowledge } from '@/services/knowledge';
import type { Json } from '@/types/database';

/**
 * Writes the Stage-E intake wizard fields (docs/10-CUSTOM-ORDERS-MEDIA-AND-INTAKE.md §3.1).
 * Agency-operated today; the same action becomes the client's self-serve save
 * once Phase-2 client logins land — no rewrite (docs/10 §9).
 */

export interface UpdateIntakeState {
  error: string | null;
  success: boolean;
}

export const initialUpdateIntakeState: UpdateIntakeState = { error: null, success: false };

const MEDIA_HANDLING_VALUES = ['match_catalogue', 'accept_any', 'reject'] as const;
const BUSINESS_TYPE_VALUES = ['product', 'service'] as const;
/** App-level allow-list (docs/11 §2.3) — payment_method(s) are plain text/text[], not a DB enum. */
const PAYMENT_METHOD_VALUES = ['cod', 'manual_transfer', 'gateway'] as const;

export async function updateIntakeAction(
  tenantId: string,
  _prev: UpdateIntakeState,
  formData: FormData,
): Promise<UpdateIntakeState> {
  const systemPrompt = String(formData.get('system_prompt') ?? '');
  const catalogRaw = String(formData.get('catalog_data') ?? '').trim();
  const customOrderInstructions = String(formData.get('custom_order_instructions') ?? '').trim() || null;
  const mediaHandlingRaw = String(formData.get('media_handling') ?? 'match_catalogue');
  const mediaHandling = (MEDIA_HANDLING_VALUES as readonly string[]).includes(mediaHandlingRaw)
    ? mediaHandlingRaw
    : 'match_catalogue';
  const businessTypeRaw = String(formData.get('business_type') ?? 'product');
  const businessType = (BUSINESS_TYPE_VALUES as readonly string[]).includes(businessTypeRaw)
    ? businessTypeRaw
    : 'product';
  const bookingLink = String(formData.get('booking_link') ?? '').trim() || null;
  const customOrdersEnabled = formData.get('custom_orders_enabled') === 'on';
  const customOrdersRequireApproval = formData.get('custom_orders_require_approval') === 'on';
  const knowledgeBaseRaw = String(formData.get('knowledge_base_json') ?? '').trim();
  const businessHoursRaw = String(formData.get('business_hours_json') ?? '').trim();
  const timezone = String(formData.get('timezone') ?? '').trim() || null;
  const paymentsEnabled = formData.get('payments_enabled') === 'on';
  const paymentMethodsRaw = formData.getAll('payment_methods').map(String);
  const paymentMethods = paymentMethodsRaw.filter((m) => (PAYMENT_METHOD_VALUES as readonly string[]).includes(m));
  const paymentInstructions = String(formData.get('payment_instructions') ?? '').trim() || null;
  const defaultCurrency = String(formData.get('default_currency') ?? '').trim() || 'PKR';
  const prepaidRequired = formData.get('prepaid_required') === 'on';

  let catalogData: Json = {};
  if (catalogRaw) {
    try {
      catalogData = JSON.parse(catalogRaw) as Json;
    } catch {
      return { error: 'Catalogue must be valid JSON.', success: false };
    }
  }

  let knowledgeBase: Json | null = null;
  if (knowledgeBaseRaw) {
    try {
      knowledgeBase = JSON.parse(knowledgeBaseRaw) as Json;
    } catch {
      return { error: 'Knowledge base was malformed — please retry.', success: false };
    }
  }

  let businessHours: Json | null = null;
  if (businessHoursRaw) {
    try {
      businessHours = JSON.parse(businessHoursRaw) as Json;
    } catch {
      return { error: 'Business hours were malformed — please retry.', success: false };
    }
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('tenants')
    .update({
      system_prompt: systemPrompt,
      catalog_data: catalogData,
      custom_order_instructions: customOrderInstructions,
      media_handling: mediaHandling,
      custom_orders_enabled: customOrdersEnabled,
      custom_orders_require_approval: customOrdersRequireApproval,
      business_type: businessType,
      booking_link: bookingLink,
      knowledge_base: knowledgeBase,
      business_hours: businessHours,
      timezone,
      payments_enabled: paymentsEnabled,
      payment_methods: paymentMethods.length ? paymentMethods : ['cod'],
      payment_instructions: paymentInstructions,
      default_currency: defaultCurrency,
      prepaid_required: prepaidRequired,
    })
    .eq('id', tenantId);

  if (error) return { error: error.message, success: false };

  // Stage-N re-embed (docs/12 §5.2) — runs after the response so it never blocks
  // the save; best-effort, logged rather than surfaced to the agency user.
  after(async () => {
    const tenant = await tenants.getById(tenantId);
    if (!tenant) return;
    try {
      await ingestTenantKnowledge(tenant, catalogData, knowledgeBase);
    } catch (err) {
      console.error('[intake] knowledge re-embed failed', { tenantId, err });
    }
  });

  revalidatePath('/admin/clients');
  revalidatePath(`/admin/clients/${tenantId}/intake`);
  return { error: null, success: true };
}
