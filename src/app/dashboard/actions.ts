'use server';

import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { assertTenantAccess, getCallerContext } from '@/lib/auth/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { notify } from '@/services/notifications';
import * as tenants from '@/services/tenants';
import { entitlementsFor } from '@/lib/entitlements';
import { deleteTenantSecret } from '@/lib/secrets';
import { log } from '@/lib/log';
import type { Database } from '@/types/database';
import {
  channelFlagsFromIds,
  channelLimitMessage,
  pruneRequestedPlatforms,
  wouldExceedChannelLimit,
} from '@/lib/channels';
import {
  PLATFORM_CHANNEL_VALUES,
  type DisconnectChannelState,
  type EnableWidgetState,
  type PlatformChannel,
  type RequestPlatformSetupState,
} from './action-state';

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
  const flags = channelFlagsFromIds({
    whatsappPhoneNumberId: tenantForLimit?.whatsappPhoneNumberId,
    metaPageId: tenantForLimit?.metaPageId,
    instagramId: tenantForLimit?.instagramId,
    widgetPublicKey: tenantForLimit?.widgetPublicKey,
  });
  if (wouldExceedChannelLimit(flags, requestedPlatforms, entitlements.maxChannels)) {
    return { error: channelLimitMessage(entitlements.maxChannels), success: false };
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

function originsFromDomain(raw: string): string[] | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    if (!url.hostname || url.hostname.includes(' ')) return null;
    return [`${url.protocol}//${url.host}`];
  } catch {
    return null;
  }
}

function newWidgetKey(): string {
  return `pk_live_${randomBytes(16).toString('hex')}`;
}

async function requireOwner(tenantId: string): Promise<{ error: string } | { ok: true }> {
  const ctx = await getCallerContext();
  if (!ctx) return { error: 'Unauthorized.' };
  try {
    assertTenantAccess(ctx, tenantId);
  } catch {
    return { error: 'Forbidden: tenant not accessible.' };
  }
  if (!ctx.isPlatformAdmin && !ctx.memberships.some((m) => m.tenantId === tenantId && m.role === 'tenant_admin')) {
    return { error: 'Forbidden: only a business owner may manage channels.' };
  }
  return { ok: true };
}

/**
 * Self-serve website chat: mint (or keep) a public widget key and lock it to
 * the owner's domain. Never returns or logs the key from a secret store — it
 * is a public embed id, the same `pk_live_` value the admin create flow already
 * showed once.
 */
export async function enableWidgetAction(
  tenantId: string,
  _prev: EnableWidgetState,
  formData: FormData,
): Promise<EnableWidgetState> {
  const gate = await requireOwner(tenantId);
  if ('error' in gate) return { error: gate.error, success: false };

  const origins = originsFromDomain(String(formData.get('domain') ?? ''));
  if (!origins) return { error: 'Enter a website domain, like acme.com.', success: false };

  const tenant = await tenants.getById(tenantId);
  if (!tenant) return { error: 'Tenant not found.', success: false };

  const flags = channelFlagsFromIds({
    whatsappPhoneNumberId: tenant.whatsappPhoneNumberId,
    metaPageId: tenant.metaPageId,
    instagramId: tenant.instagramId,
    widgetPublicKey: tenant.widgetPublicKey,
  });
  const maxChannels = entitlementsFor(tenant.plan).maxChannels;
  if (wouldExceedChannelLimit(flags, ['web'], maxChannels)) {
    return { error: channelLimitMessage(maxChannels), success: false };
  }

  const widgetPublicKey = tenant.widgetPublicKey ?? newWidgetKey();
  const nextFlags = { ...flags, web: true };
  const supabase = await createSupabaseServerClient();
  const { data: current } = await supabase
    .from('tenants')
    .select('requested_platforms')
    .eq('id', tenantId)
    .maybeSingle();
  const { error } = await supabase
    .from('tenants')
    .update({
      widget_public_key: widgetPublicKey,
      widget_allowed_origins: origins,
      requested_platforms: pruneRequestedPlatforms(current?.requested_platforms, nextFlags),
    })
    .eq('id', tenantId);

  if (error) return { error: error.message, success: false };

  revalidatePath('/dashboard/business');
  revalidatePath('/admin/clients');
  revalidatePath(`/admin/clients/${tenantId}`);
  return { error: null, success: true };
}

export async function rotateWidgetKeyAction(tenantId: string): Promise<EnableWidgetState> {
  const gate = await requireOwner(tenantId);
  if ('error' in gate) return { error: gate.error, success: false };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('tenants')
    .update({ widget_public_key: newWidgetKey() })
    .eq('id', tenantId)
    .not('widget_public_key', 'is', null);
  if (error) return { error: error.message, success: false };

  revalidatePath('/dashboard/business');
  revalidatePath('/admin/clients');
  revalidatePath(`/admin/clients/${tenantId}`);
  return { error: null, success: true };
}

/**
 * Disconnects one channel, freeing its plan slot (lib/channels.ts) and best-effort
 * deleting its Vault secret (the tenant-row column is the only reference to it —
 * see deleteTenantSecret's docstring). Row-level RLS (tenants_update_self, 0018)
 * already lets a tenant_admin write any column on their own row, so this uses the
 * same RLS-respecting server client as enableWidgetAction/rotateWidgetKeyAction
 * above, not the service-role client the unauthenticated OAuth callbacks use.
 */
export async function disconnectChannelAction(
  tenantId: string,
  channel: PlatformChannel,
): Promise<DisconnectChannelState> {
  const gate = await requireOwner(tenantId);
  if ('error' in gate) return { error: gate.error };

  const tenant = await tenants.getById(tenantId);
  if (!tenant) return { error: 'Tenant not found.' };

  const update: Database['public']['Tables']['tenants']['Update'] = {};
  const secretsToDelete: string[] = [];

  switch (channel) {
    case 'facebook': {
      if (!tenant.metaPageId) return { error: 'Facebook is not connected.' };
      update.meta_page_id = null;
      update.meta_token_secret_id = null;
      if (tenant.metaTokenSecretId) secretsToDelete.push(tenant.metaTokenSecretId);
      // Instagram riding on the Facebook Page token (no standalone token of its
      // own — see instagramTokenSecretId's docstring in types/domain.ts) can't
      // send/receive once the Page connection is gone, so take it down too.
      if (tenant.instagramId && !tenant.instagramTokenSecretId) {
        update.instagram_id = null;
      }
      break;
    }
    case 'instagram': {
      if (!tenant.instagramId) return { error: 'Instagram is not connected.' };
      update.instagram_id = null;
      update.instagram_token_secret_id = null;
      if (tenant.instagramTokenSecretId) secretsToDelete.push(tenant.instagramTokenSecretId);
      break;
    }
    case 'whatsapp': {
      if (!tenant.whatsappPhoneNumberId) return { error: 'WhatsApp is not connected.' };
      update.whatsapp_phone_number_id = null;
      update.whatsapp_token_secret_id = null;
      if (tenant.whatsappTokenSecretId) secretsToDelete.push(tenant.whatsappTokenSecretId);
      break;
    }
    case 'web': {
      if (!tenant.widgetPublicKey) return { error: 'Website chat is not enabled.' };
      update.widget_public_key = null;
      update.widget_allowed_origins = [];
      break;
    }
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('tenants').update(update).eq('id', tenantId);
  if (error) return { error: error.message };

  for (const secretId of secretsToDelete) {
    try {
      await deleteTenantSecret(secretId);
    } catch (err) {
      // The tenant row is already detached from this secret — an orphaned Vault
      // row is a cleanup nit, not a reason to report the disconnect as failed.
      log.warn('[disconnect] failed to delete orphaned vault secret', {
        secretId,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  revalidatePath('/dashboard/business');
  revalidatePath('/admin/clients');
  revalidatePath(`/admin/clients/${tenantId}`);
  return { error: null };
}
