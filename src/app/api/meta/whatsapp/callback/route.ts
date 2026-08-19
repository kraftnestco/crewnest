import { revalidatePath } from 'next/cache';
import { type NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import {
  channelFlagsFromIds,
  channelLimitMessage,
  pruneRequestedPlatforms,
  wouldExceedChannelLimit,
} from '@/lib/channels';
import { entitlementsFor } from '@/lib/entitlements';
import { log } from '@/lib/log';
import { setTenantSecret } from '@/lib/secrets';
import { createServiceClient } from '@/lib/supabase/service';
import { metaPopupResponse } from '@/services/meta/popupClose';
import {
  exchangeForLongLivedToken,
  exchangeWhatsAppCodeForToken,
  fetchWhatsAppPhoneAsset,
  META_WHATSAPP_OAUTH_STATE_COOKIE,
} from '@/services/meta/oauth';

export const runtime = 'nodejs';
export const maxDuration = 30;

function popupResponse(ok: boolean, error?: string) {
  return metaPopupResponse(
    { type: 'whatsapp-connected', ok, error },
    META_WHATSAPP_OAUTH_STATE_COOKIE,
    '/api/meta/whatsapp',
  );
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const wasCancelled = url.searchParams.has('error');

  if (wasCancelled) {
    return popupResponse(false, 'Connection was cancelled.');
  }

  const cookieValue = req.cookies.get(META_WHATSAPP_OAUTH_STATE_COOKIE)?.value;
  const [nonce, tenantId] = cookieValue?.split(':') ?? [];
  if (!code || !state || !nonce || !tenantId || nonce !== state) {
    return popupResponse(false, 'Invalid connection attempt. Please try again.');
  }

  try {
    const shortLivedToken = await exchangeWhatsAppCodeForToken(code);
    let accessToken = shortLivedToken;
    try {
      accessToken = await exchangeForLongLivedToken(shortLivedToken);
    } catch {
      // Embedded Signup sometimes mints a token that cannot be exchanged; use the original.
    }

    const asset = await fetchWhatsAppPhoneAsset(accessToken);
    if (!asset) {
      return popupResponse(
        false,
        'No WhatsApp Business number found. Finish WhatsApp setup in Meta and try again.',
      );
    }

    const svc = createServiceClient();
    const { data: tenant, error: loadError } = await svc
      .from('tenants')
      .select(
        'plan, whatsapp_phone_number_id, meta_page_id, instagram_id, widget_public_key, requested_platforms',
      )
      .eq('id', tenantId)
      .maybeSingle();
    if (loadError || !tenant) throw new Error(loadError?.message ?? 'Tenant not found.');

    const current = channelFlagsFromIds({
      whatsappPhoneNumberId: tenant.whatsapp_phone_number_id,
      metaPageId: tenant.meta_page_id,
      instagramId: tenant.instagram_id,
      widgetPublicKey: tenant.widget_public_key,
    });
    const maxChannels = entitlementsFor(tenant.plan).maxChannels;
    if (wouldExceedChannelLimit(current, ['whatsapp'], maxChannels)) {
      return popupResponse(false, channelLimitMessage(maxChannels));
    }

    const whatsappTokenSecretId = await setTenantSecret(`tenant:${tenantId}:whatsapp`, accessToken);
    const nextFlags = { ...current, whatsapp: true };

    const { error } = await svc
      .from('tenants')
      .update({
        whatsapp_phone_number_id: asset.phoneNumberId,
        whatsapp_token_secret_id: whatsappTokenSecretId,
        requested_platforms: pruneRequestedPlatforms(tenant.requested_platforms, nextFlags),
      })
      .eq('id', tenantId);
    if (error) throw new Error(error.message);

    revalidatePath('/dashboard/business');
    revalidatePath('/admin/clients');
    revalidatePath(`/admin/clients/${tenantId}`);
    return popupResponse(true);
  } catch (err) {
    log.error('[whatsapp connect] OAuth callback failed', {
      tenantId,
      error: err instanceof Error ? err.message : 'unknown',
    });
    Sentry.captureException(err, { tags: { flow: 'whatsapp-oauth-connect', tenantId } });
    return popupResponse(false, 'Something went wrong connecting WhatsApp. Please try again.');
  }
}
