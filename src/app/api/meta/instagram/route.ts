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
import { buildInstagramAuthorizeUrl, META_INSTAGRAM_OAUTH_STATE_COOKIE } from '@/services/meta/oauth';

export const runtime = 'nodejs';

/**
 * OAuth initiate for standalone "Connect with Instagram" (no Facebook Page
 * required — Meta's Instagram API with Instagram Login). Mirrors
 * api/meta/whatsapp/route.ts exactly; see that file's comments for the
 * tenantId/state-cookie trust model, which is identical here.
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

  if (!env.INSTAGRAM_APP_ID) {
    return new Response('Instagram Business Login is not configured on this deployment.', { status: 500 });
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
  const maxChannels = entitlementsFor(tenant.plan).maxChannels;
  if (!flags.instagram && wouldExceedChannelLimit(flags, ['instagram'], maxChannels)) {
    return new Response(channelLimitMessage(maxChannels), { status: 403 });
  }

  const nonce = randomBytes(16).toString('hex');
  const res = NextResponse.redirect(buildInstagramAuthorizeUrl(nonce));
  res.cookies.set(META_INSTAGRAM_OAUTH_STATE_COOKIE, `${nonce}:${tenantId}`, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/api/meta/instagram',
    maxAge: 600,
  });
  return res;
}
