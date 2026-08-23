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
  exchangeForLongLivedInstagramToken,
  exchangeInstagramCodeForToken,
  fetchInstagramProfile,
  META_INSTAGRAM_OAUTH_STATE_COOKIE,
  subscribeInstagramWebhook,
} from '@/services/meta/oauth';

export const runtime = 'nodejs';
export const maxDuration = 30; // several sequential Graph API round-trips

function popupResponse(ok: boolean, error?: string, note?: string) {
  return metaPopupResponse(
    { type: 'instagram-connected', ok, error, note },
    META_INSTAGRAM_OAUTH_STATE_COOKIE,
    '/api/meta/instagram',
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

  const cookieValue = req.cookies.get(META_INSTAGRAM_OAUTH_STATE_COOKIE)?.value;
  const [nonce, tenantId] = cookieValue?.split(':') ?? [];
  if (!code || !state || !nonce || !tenantId || nonce !== state) {
    return popupResponse(false, 'Invalid connection attempt. Please try again.');
  }

  try {
    const { accessToken: shortLivedToken } = await exchangeInstagramCodeForToken(code);
    const accessToken = await exchangeForLongLivedInstagramToken(shortLivedToken);
    const profile = await fetchInstagramProfile(accessToken);

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
    if (!current.instagram && wouldExceedChannelLimit(current, ['instagram'], maxChannels)) {
      return popupResponse(false, channelLimitMessage(maxChannels));
    }

    // Best-effort — a failed subscribe still leaves the account connected;
    // messaging may already work if it was subscribed by a prior connect.
    await subscribeInstagramWebhook(accessToken);

    const instagramTokenSecretId = await setTenantSecret(`tenant:${tenantId}:instagram`, accessToken);
    const nextFlags = { ...current, instagram: true };

    const { error } = await svc
      .from('tenants')
      .update({
        instagram_id: profile.id,
        instagram_token_secret_id: instagramTokenSecretId,
        requested_platforms: pruneRequestedPlatforms(tenant.requested_platforms, nextFlags),
      })
      .eq('id', tenantId);
    if (error) {
      // instagram_id has a unique index (tenants_instagram_id_uidx) — see
      // 0049_instagram_business_login.sql.
      if (error.code === '23505') {
        return popupResponse(
          false,
          'That Instagram account is already connected to a different ClerkNest workspace. Disconnect it there first, or connect a different account.',
        );
      }
      throw new Error(error.message);
    }

    revalidatePath('/dashboard/business');
    revalidatePath('/admin/clients');
    revalidatePath(`/admin/clients/${tenantId}`);
    return popupResponse(true, undefined, profile.username ? `Instagram connected (@${profile.username}).` : undefined);
  } catch (err) {
    log.error('[instagram connect] OAuth callback failed', {
      tenantId,
      error: err instanceof Error ? err.message : 'unknown',
    });
    Sentry.captureException(err, { tags: { flow: 'instagram-oauth-connect', tenantId } });
    return popupResponse(false, 'Something went wrong connecting Instagram. Please try again.');
  }
}
