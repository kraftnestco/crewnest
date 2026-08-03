'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getCallerContext } from '@/lib/auth/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { setTenantSecret } from '@/lib/secrets';
import { eraseTenant } from '@/services/dataLifecycle';
import type { Database, Json } from '@/types/database';
import type { CreateTenantState, OffboardTenantState, UpdateTenantState } from './action-state';

type TenantSecretIdFields = Pick<
  Database['public']['Tables']['tenants']['Update'],
  'openai_key_secret_id' | 'meta_token_secret_id' | 'whatsapp_token_secret_id'
>;

function optionalString(value: FormDataEntryValue | null): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  return s.length > 0 ? s : null;
}

export async function createTenantAction(
  _prev: CreateTenantState,
  formData: FormData,
): Promise<CreateTenantState> {
  const ctx = await getCallerContext();
  if (!ctx?.isPlatformAdmin) {
    return { error: 'Forbidden.', success: false, widgetPublicKey: null };
  }

  const businessName = optionalString(formData.get('business_name'));
  if (!businessName) {
    return { error: 'Business name is required.', success: false, widgetPublicKey: null };
  }

  const slug = optionalString(formData.get('slug'));
  const metaPageId = optionalString(formData.get('meta_page_id'));
  const instagramId = optionalString(formData.get('instagram_id'));
  const whatsappPhoneNumberId = optionalString(formData.get('whatsapp_phone_number_id'));
  const systemPrompt = String(formData.get('system_prompt') ?? '');
  const catalogRaw = optionalString(formData.get('catalog_data'));
  const allowedOriginsRaw = optionalString(formData.get('widget_allowed_origins'));

  let catalogData: Json = {};
  if (catalogRaw) {
    try {
      catalogData = JSON.parse(catalogRaw) as Json;
    } catch {
      return { error: 'Catalogue must be valid JSON.', success: false, widgetPublicKey: null };
    }
  }

  const widgetAllowedOrigins = allowedOriginsRaw
    ? allowedOriginsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const widgetPublicKey = `pk_live_${randomBytes(16).toString('hex')}`;

  const supabase = await createSupabaseServerClient();
  const { data: tenant, error: insertError } = await supabase
    .from('tenants')
    .insert({
      business_name: businessName,
      slug,
      meta_page_id: metaPageId,
      instagram_id: instagramId,
      whatsapp_phone_number_id: whatsappPhoneNumberId,
      system_prompt: systemPrompt,
      catalog_data: catalogData,
      widget_public_key: widgetPublicKey,
      widget_allowed_origins: widgetAllowedOrigins,
    })
    .select('id')
    .single();

  if (insertError || !tenant) {
    return { error: insertError?.message ?? 'Failed to create tenant.', success: false, widgetPublicKey: null };
  }

  const secretUpdates: TenantSecretIdFields = {};
  const openaiKey = optionalString(formData.get('openai_byok_key'));
  const metaToken = optionalString(formData.get('meta_page_token'));
  const whatsappToken = optionalString(formData.get('whatsapp_token'));

  try {
    if (openaiKey) {
      secretUpdates.openai_key_secret_id = await setTenantSecret(`tenant:${tenant.id}:openai`, openaiKey);
    }
    if (metaToken) {
      secretUpdates.meta_token_secret_id = await setTenantSecret(`tenant:${tenant.id}:meta`, metaToken);
    }
    if (whatsappToken) {
      secretUpdates.whatsapp_token_secret_id = await setTenantSecret(`tenant:${tenant.id}:whatsapp`, whatsappToken);
    }
  } catch (err) {
    return {
      error: `Client created, but storing secrets failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      success: false,
      widgetPublicKey,
    };
  }

  if (Object.keys(secretUpdates).length > 0) {
    const { error: updateError } = await supabase.from('tenants').update(secretUpdates).eq('id', tenant.id);
    if (updateError) {
      return {
        error: `Client created, but linking secrets failed: ${updateError.message}`,
        success: false,
        widgetPublicKey,
      };
    }
  }

  revalidatePath('/admin/clients');
  return { error: null, success: true, widgetPublicKey };
}

export async function updateTenantAction(
  tenantId: string,
  _prev: UpdateTenantState,
  formData: FormData,
): Promise<UpdateTenantState> {
  const ctx = await getCallerContext();
  if (!ctx?.isPlatformAdmin) {
    return { error: 'Forbidden.', success: false };
  }

  const businessName = optionalString(formData.get('business_name'));
  if (!businessName) {
    return { error: 'Business name is required.', success: false };
  }

  const slug = optionalString(formData.get('slug'));
  const metaPageId = optionalString(formData.get('meta_page_id'));
  const instagramId = optionalString(formData.get('instagram_id'));
  const whatsappPhoneNumberId = optionalString(formData.get('whatsapp_phone_number_id'));
  const systemPrompt = String(formData.get('system_prompt') ?? '');
  const catalogRaw = optionalString(formData.get('catalog_data'));
  const allowedOriginsRaw = optionalString(formData.get('widget_allowed_origins'));
  const isActive = formData.get('is_active') === 'on';


  let catalogData: Json = {};
  if (catalogRaw) {
    try {
      catalogData = JSON.parse(catalogRaw) as Json;
    } catch {
      return { error: 'Catalogue must be valid JSON.', success: false };
    }
  }

  const widgetAllowedOrigins = allowedOriginsRaw
    ? allowedOriginsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const supabase = await createSupabaseServerClient();

  // Appointment booking (docs/24). The dialog only shows these for a service
  // business, but that's UI convenience — re-check the stored business_type
  // here so a hand-crafted POST can't enable booking on a product tenant,
  // where the tools are gated off and the setting would do nothing.
  const { data: existing } = await supabase
    .from('tenants')
    .select('business_type')
    .eq('id', tenantId)
    .maybeSingle();
  const isService = existing?.business_type === 'service';

  const bookingModeRaw = String(formData.get('booking_mode') ?? '').trim();
  const bookingUpdates = isService
    ? {
        booking_enabled: formData.get('booking_enabled') === 'on',
        booking_mode: bookingModeRaw === 'own_link' || bookingModeRaw === 'calcom' ? bookingModeRaw : null,
        booking_own_link: String(formData.get('booking_own_link') ?? '').trim() || null,
        booking_duration_minutes: Math.min(
          Math.max(Number.parseInt(String(formData.get('booking_duration_minutes') ?? ''), 10) || 30, 5),
          480,
        ),
      }
    : {};

  const secretUpdates: TenantSecretIdFields = {};
  const openaiKey = optionalString(formData.get('openai_byok_key'));
  const metaToken = optionalString(formData.get('meta_page_token'));
  const whatsappToken = optionalString(formData.get('whatsapp_token'));

  try {
    if (openaiKey) {
      secretUpdates.openai_key_secret_id = await setTenantSecret(`tenant:${tenantId}:openai`, openaiKey);
    }
    if (metaToken) {
      secretUpdates.meta_token_secret_id = await setTenantSecret(`tenant:${tenantId}:meta`, metaToken);
    }
    if (whatsappToken) {
      secretUpdates.whatsapp_token_secret_id = await setTenantSecret(`tenant:${tenantId}:whatsapp`, whatsappToken);
    }
  } catch (err) {
    return {
      error: `Storing secrets failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      success: false,
    };
  }

  const { error: updateError } = await supabase
    .from('tenants')
    .update({
      business_name: businessName,
      slug,
      meta_page_id: metaPageId,
      instagram_id: instagramId,
      whatsapp_phone_number_id: whatsappPhoneNumberId,
      system_prompt: systemPrompt,
      catalog_data: catalogData,
      widget_allowed_origins: widgetAllowedOrigins,
      is_active: isActive,
      ...bookingUpdates,
      ...secretUpdates,
    })
    .eq('id', tenantId);

  if (updateError) {
    return { error: updateError.message, success: false };
  }

  revalidatePath('/admin/clients');
  return { error: null, success: true };
}

/**
 * Tenant-wide right-to-erasure / offboarding (docs/17 §4.1, Stage T). Irreversible: every
 * order-media object under the tenant's storage prefix, every Vault secret it references,
 * and the tenant row itself (DB cascade drops sessions/messages/orders/usage/notifications)
 * are gone after this returns. Requires the caller to type the exact business name as a
 * confirmation gate — platform-admin only, same guard as create/update.
 */
export async function offboardTenantAction(
  tenantId: string,
  _prev: OffboardTenantState,
  formData: FormData,
): Promise<OffboardTenantState> {
  const ctx = await getCallerContext();
  if (!ctx?.isPlatformAdmin) {
    return { error: 'Forbidden.', success: false };
  }

  const supabase = await createSupabaseServerClient();
  const { data: tenant, error: lookupError } = await supabase
    .from('tenants')
    .select('business_name')
    .eq('id', tenantId)
    .single();

  if (lookupError || !tenant) {
    return { error: lookupError?.message ?? 'Client not found.', success: false };
  }

  const confirmName = optionalString(formData.get('confirm_name')) ?? '';
  if (confirmName !== tenant.business_name) {
    return { error: 'Business name did not match, so nothing was deleted.', success: false };
  }

  try {
    await eraseTenant(tenantId, ctx.userId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to offboard client.', success: false };
  }

  revalidatePath('/admin/clients');
  return { error: null, success: true };
}
