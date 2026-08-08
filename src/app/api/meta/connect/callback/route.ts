import { revalidatePath } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { log } from '@/lib/log';
import { setTenantSecret } from '@/lib/secrets';
import { createServiceClient } from '@/lib/supabase/service';
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchInstagramAccountId,
  fetchManagedPages,
  META_OAUTH_STATE_COOKIE,
} from '@/services/meta/oauth';

export const runtime = 'nodejs';
export const maxDuration = 30; // several sequential Graph API round-trips

interface PopupMessage {
  type: 'meta-connected';
  ok: boolean;
  error?: string;
}

/**
 * Renders the popup's closing act: post the result back to channel-setup.tsx
 * (the opener) and close, or — if there's no opener (direct nav, or a popup
 * blocker forced a same-tab open) — fall back to a normal redirect.
 *
 * `message.error` is always one of the fixed strings below, NEVER Meta's raw
 * error text or anything else attacker/Meta-controlled — it gets embedded
 * into an inline <script> via JSON.stringify, so reflecting untrusted text
 * here would be an XSS vector.
 */
function popupResponse(message: PopupMessage): NextResponse {
  const html = `<!doctype html>
<html><body>
<script>
  if (window.opener) {
    window.opener.postMessage(${JSON.stringify(message)}, window.location.origin);
    window.close();
  } else {
    window.location.href = '/dashboard/business';
  }
</script>
<p>${message.ok ? 'Connected. You can close this window.' : 'Connection failed. You can close this window.'}</p>
</body></html>`;
  const res = new NextResponse(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
  // One-shot: the state cookie is consumed here regardless of outcome.
  res.cookies.set(META_OAUTH_STATE_COOKIE, '', { path: '/api/meta/connect', maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const wasCancelled = url.searchParams.has('error');

  if (wasCancelled) {
    return popupResponse({ type: 'meta-connected', ok: false, error: 'Connection was cancelled.' });
  }

  const cookieValue = req.cookies.get(META_OAUTH_STATE_COOKIE)?.value;
  const [nonce, tenantId] = cookieValue?.split(':') ?? [];
  if (!code || !state || !nonce || !tenantId || nonce !== state) {
    return popupResponse({ type: 'meta-connected', ok: false, error: 'Invalid connection attempt. Please try again.' });
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
      return popupResponse({
        type: 'meta-connected',
        ok: false,
        error: "No Facebook Page found. Make sure you're an admin of a Page and try again.",
      });
    }

    const instagramId = await fetchInstagramAccountId(page.id, page.accessToken);
    const metaTokenSecretId = await setTenantSecret(`tenant:${tenantId}:meta`, page.accessToken);

    // Service-role, not the caller's session: the same posture as the Meta
    // webhook route for a privileged write. tenantId here is server-derived
    // (from the state cookie minted in the initiate route, only reachable
    // after that route's own tenant_admin check), never client input.
    const svc = createServiceClient();
    const { error } = await svc
      .from('tenants')
      .update({ meta_page_id: page.id, instagram_id: instagramId, meta_token_secret_id: metaTokenSecretId })
      .eq('id', tenantId);
    if (error) throw new Error(error.message);

    revalidatePath('/dashboard/business');
    return popupResponse({ type: 'meta-connected', ok: true });
  } catch (err) {
    log.error('[meta connect] OAuth callback failed', {
      tenantId,
      error: err instanceof Error ? err.message : 'unknown',
    });
    Sentry.captureException(err, { tags: { flow: 'meta-oauth-connect', tenantId } });
    return popupResponse({
      type: 'meta-connected',
      ok: false,
      error: 'Something went wrong connecting your account. Please try again.',
    });
  }
}
