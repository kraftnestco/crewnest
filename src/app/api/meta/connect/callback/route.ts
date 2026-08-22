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
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchInstagramAccountId,
  fetchManagedPages,
  META_OAUTH_STATE_COOKIE,
} from '@/services/meta/oauth';

export const runtime = 'nodejs';
export const maxDuration = 30; // several sequential Graph API round-trips

function popupResponse(ok: boolean, error?: string) {
  return metaPopupResponse(
    { type: 'meta-connected', ok, error },
    META_OAUTH_STATE_COOKIE,
    '/api/meta/connect',
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

  const cookieValue = req.cookies.get(META_OAUTH_STATE_COOKIE)?.value;
  const [nonce, tenantId] = cookieValue?.split(':') ?? [];
  if (!code || !state || !nonce || !tenantId || nonce !== state) {
    return popupResponse(false, 'Invalid connection attempt. Please try again.');
  }

  try {
    const shortLivedToken = await exchangeCodeForToken(code);
    const longLivedUserToken = await exchangeForLongLivedToken(shortLivedToken);
    const pages = await fetchManagedPages(longLivedUserToken);

    // Managing more than one Page per tenant is out of scope for this pass
    // (docs/27 §5 C2 — buildable portion only) — `tenants` has a single
    // meta_page_id column, so the first Page returned wins.
    const page = pages[0];
    if (!page) {
      return popupResponse(false, "No Facebook Page found. Make sure you're an admin of a Page and try again.");
    }

    const instagramId = await fetchInstagramAccountId(page.id, page.accessToken);

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
    const adding: Array<'facebook' | 'instagram'> = [];
    if (!current.facebook) adding.push('facebook');
    if (instagramId && !current.instagram) adding.push('instagram');
    const maxChannels = entitlementsFor(tenant.plan).maxChannels;
    if (wouldExceedChannelLimit(current, adding, maxChannels)) {
      return popupResponse(false, channelLimitMessage(maxChannels));
    }

    const metaTokenSecretId = await setTenantSecret(`tenant:${tenantId}:meta`, page.accessToken);
    const nextFlags = {
      ...current,
      facebook: true,
      instagram: Boolean(instagramId) || current.instagram,
    };

    const { error } = await svc
      .from('tenants')
      .update({
        meta_page_id: page.id,
        instagram_id: instagramId ?? tenant.instagram_id,
        meta_token_secret_id: metaTokenSecretId,
        requested_platforms: pruneRequestedPlatforms(tenant.requested_platforms, nextFlags),
      })
      .eq('id', tenantId);
    if (error) throw new Error(error.message);

    revalidatePath('/dashboard/business');
    revalidatePath('/admin/clients');
    revalidatePath(`/admin/clients/${tenantId}`);
    return popupResponse(true);
  } catch (err) {
    log.error('[meta connect] OAuth callback failed', {
      tenantId,
      error: err instanceof Error ? err.message : 'unknown',
    });
    Sentry.captureException(err, { tags: { flow: 'meta-oauth-connect', tenantId } });
    // TEMP diagnostic: surface the real Graph/DB error instead of a generic
    // message so we can see what's failing without prod log access. Revert
    // to the generic copy once the Facebook/Instagram connect flow is confirmed working.
    const detail = err instanceof Error ? err.message : 'unknown error';
    return popupResponse(false, `Connect failed: ${detail}`);
  }
}
