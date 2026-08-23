import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { assertTenantAccess, getCallerContext } from '@/lib/auth/context';
import {
  channelFlagsFromIds,
  channelLimitMessage,
  wouldExceedChannelLimit,
} from '@/lib/channels';
import { entitlementsFor } from '@/lib/entitlements';
import { env } from '@/lib/env';
import { createServiceClient } from '@/lib/supabase/service';
import { buildAuthorizeUrl, META_OAUTH_STATE_COOKIE } from '@/services/meta/oauth';

export const runtime = 'nodejs';

/**
 * OAuth initiate (docs/27 §5 C2). Opened in a popup by the "Connect with
 * Facebook" button in channel-setup.tsx. `tenantId` arrives as a query
 * param — same trust level as requestPlatformSetupAction's bound arg
 * (dashboard/actions.ts): a client-supplied value that is verified against
 * the caller's own session before it's trusted for anything.
 *
 * tenantId is then carried forward ONLY via the httpOnly state cookie set
 * below, never via a query param Meta round-trips — so a forged callback
 * URL can't land a token on someone else's tenant. Meta's own `state` gets
 * just the CSRF nonce.
 */
export async function GET(req: NextRequest) {
  const tenantId = new URL(req.url).searchParams.get('tenantId');
  if (!tenantId) return new Response('Missing tenantId', { status: 400 });

  const ctx = await getCallerContext();
  if (!ctx) return new Response('Unauthorized', { status: 401 });
  try {
    assertTenantAccess(ctx, tenantId);
  } catch {
    return new Response('Forbidden', { status: 403 });
  }
  if (!ctx.isPlatformAdmin && !ctx.memberships.some((m) => m.tenantId === tenantId && m.role === 'tenant_admin')) {
    return new Response('Forbidden: only a business owner may connect channels.', { status: 403 });
  }

  if (!env.META_APP_ID) {
    return new Response('Meta app is not configured on this deployment.', { status: 500 });
  }

  const svc = createServiceClient();
  const { data: tenant } = await svc
    .from('tenants')
    .select('plan, whatsapp_phone_number_id, meta_page_id, instagram_id, widget_public_key')
    .eq('id', tenantId)
    .maybeSingle();
  if (!tenant) return new Response('Tenant not found', { status: 404 });

  const flags = channelFlagsFromIds({
    whatsappPhoneNumberId: tenant.whatsapp_phone_number_id,
    metaPageId: tenant.meta_page_id,
    instagramId: tenant.instagram_id,
    widgetPublicKey: tenant.widget_public_key,
  });
  // Only pre-check Facebook itself here — whether the chosen Page even has a
  // linked Instagram account isn't known until the OAuth round-trip
  // completes, so that check happens in the callback instead (where, if
  // Instagram alone would exceed the plan, Facebook still connects and
  // Instagram is skipped with an explanatory note rather than blocking the
  // whole flow over a channel the owner may not even have).
  const maxChannels = entitlementsFor(tenant.plan).maxChannels;
  if (!flags.facebook && wouldExceedChannelLimit(flags, ['facebook'], maxChannels)) {
    return new Response(channelLimitMessage(maxChannels), { status: 403 });
  }

  const nonce = randomBytes(16).toString('hex');
  const res = NextResponse.redirect(buildAuthorizeUrl(nonce));
  res.cookies.set(META_OAUTH_STATE_COOKIE, `${nonce}:${tenantId}`, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/api/meta/connect',
    maxAge: 600,
  });
  return res;
}
