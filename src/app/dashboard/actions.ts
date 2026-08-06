'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { assertTenantAccess, getCallerContext } from '@/lib/auth/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { notify } from '@/services/notifications';
import * as tenants from '@/services/tenants';
import { entitlementsFor, isLimited } from '@/lib/entitlements';
import { PLATFORM_CHANNEL_VALUES, type PlatformChannel, type RequestPlatformSetupState } from './action-state';

/** Switches the active tenant for a multi-membership caller. Validated server-side against ctx.memberships. */
export async function setActiveTenantAction(formData: FormData): Promise<void> {
  const tenantId = String(formData.get('tenant_id') ?? '');
  const ctx = await getCallerContext();
  if (!ctx || !ctx.memberships.some((m) => m.tenantId === tenantId)) {
    return;
  }

  const cookieStore = await cookies();
  cookieStore.set('cn_active_tenant', tenantId, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  });
  redirect('/dashboard');
}

/**
 * Client-initiated "please connect these channels" request — collects no
 * secrets (CLAUDE.md locked decision #2). Writes only the three narrow
 * columns added by migration 0019, on the caller's own tenant. Covered by
 * the existing tenants_update_self RLS policy (0018), which is why this
 * action — not a service-role write — is the sole writer for these columns.
 */
export async function requestPlatformSetupAction(
  tenantId: string,
  _prev: RequestPlatformSetupState,
  formData: FormData,
): Promise<RequestPlatformSetupState> {
  const ctx = await getCallerContext();
  if (!ctx) return { error: 'Unauthorized.', success: false };
  try {
    assertTenantAccess(ctx, tenantId);
  } catch {
    return { error: 'Forbidden: tenant not accessible.', success: false };
  }
  if (!ctx.memberships.some((m) => m.tenantId === tenantId && m.role === 'tenant_admin')) {
    return { error: 'Forbidden: only a business owner may request channel setup.', success: false };
  }

  const requestedPlatforms = formData
    .getAll('platforms')
    .map(String)
    .filter((p): p is PlatformChannel => (PLATFORM_CHANNEL_VALUES as readonly string[]).includes(p));
  const notes = String(formData.get('notes') ?? '').trim() || null;

  if (requestedPlatforms.length === 0) {
    return { error: 'Pick at least one channel to request.', success: false };
  }

  // Per-plan channel limit (lib/entitlements.ts — free plan is one channel at a
  // time; every paid plan is unlimited). Enforced at REQUEST time, not on
  // inbound traffic: a tenant who already has channels connected must never have
  // real customer messages silently dropped because their plan changed. The
  // already-connected count is included so the limit covers the resulting total,
  // not just this request in isolation.
  const tenantForLimit = await tenants.getById(tenantId);
  const entitlements = entitlementsFor(tenantForLimit?.plan);
  if (isLimited(entitlements.maxChannels)) {
    const connectedCount = tenantForLimit
      ? [
          tenantForLimit.whatsappPhoneNumberId,
          tenantForLimit.metaPageId,
          tenantForLimit.instagramId,
          tenantForLimit.widgetPublicKey,
        ].filter(Boolean).length
      : 0;
    // Requests for channels that are ALREADY connected shouldn't count twice.
    const alreadyConnected = new Set<PlatformChannel>();
    if (tenantForLimit?.whatsappPhoneNumberId) alreadyConnected.add('whatsapp');
    if (tenantForLimit?.metaPageId) alreadyConnected.add('facebook');
    if (tenantForLimit?.instagramId) alreadyConnected.add('instagram');
    if (tenantForLimit?.widgetPublicKey) alreadyConnected.add('web');
    const newChannels = requestedPlatforms.filter((p) => !alreadyConnected.has(p));

    if (connectedCount + newChannels.length > entitlements.maxChannels) {
      return {
        error:
          entitlements.maxChannels === 1
            ? 'Your plan includes one channel at a time. Upgrade to connect more.'
            : `Your plan includes up to ${entitlements.maxChannels} channels. Upgrade to connect more.`,
        success: false,
      };
    }
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('tenants')
    .update({
      requested_platforms: requestedPlatforms,
      platform_setup_notes: notes,
      platform_setup_requested_at: new Date().toISOString(),
    })
    .eq('id', tenantId);

  if (error) return { error: error.message, success: false };

  const tenant = await tenants.getById(tenantId);
  await notify({
    scope: 'agency',
    tenantId,
    type: 'channel_request',
    entityType: 'tenant',
    entityId: tenantId,
    title: 'Channel setup requested',
    body: tenant
      ? `${tenant.businessName} — ${requestedPlatforms.join(', ')}`
      : requestedPlatforms.join(', '),
    link: `/admin/clients/${tenantId}`,
  });

  revalidatePath('/dashboard/business');
  revalidatePath('/admin/clients');
  return { error: null, success: true };
}
