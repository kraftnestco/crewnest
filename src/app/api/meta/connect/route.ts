import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { assertTenantAccess, getCallerContext } from '@/lib/auth/context';
import { env } from '@/lib/env';
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
