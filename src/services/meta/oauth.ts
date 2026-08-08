import 'server-only';
import { env } from '@/lib/env';
import { META_GRAPH_BASE } from '@/lib/constants';

/**
 * Facebook Login for Business — the OAuth half of Meta onboarding (docs/27
 * §5 C2, CLAUDE.md #6 "embedded-signup OAuth later, same Vault columns").
 * This module only turns a `code` into a page token + page/IG ids; storing
 * them is the callback route's job, via the exact same `setTenantSecret`
 * call and `meta_token_secret_id` column the manual-token-paste admin flow
 * already uses (src/app/admin/clients/actions.ts) — OAuth is just a second
 * writer of the same slot, not a new one.
 *
 * Meta renames this product and its scopes more often than the flow itself
 * changes — verify OAUTH_SCOPES against developers.facebook.com before
 * going live. The exchange sequence below (code → short-lived → long-lived
 * → page tokens → linked IG account) is the stable part.
 */
const OAUTH_DIALOG_BASE = 'https://www.facebook.com';
const OAUTH_SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
  'instagram_basic',
  'instagram_manage_messages',
  'business_management',
].join(',');

/** Name of the short-lived httpOnly cookie carrying the CSRF nonce + tenantId between initiate and callback. */
export const META_OAUTH_STATE_COOKIE = 'cn_meta_oauth_state';

export function metaRedirectUri(): string {
  return `${env.NEXT_PUBLIC_APP_URL}/api/meta/connect/callback`;
}

export function buildAuthorizeUrl(state: string): string {
  if (!env.META_APP_ID) throw new Error('META_APP_ID is not configured.');
  const url = new URL(`${OAUTH_DIALOG_BASE}/${env.META_GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set('client_id', env.META_APP_ID);
  url.searchParams.set('redirect_uri', metaRedirectUri());
  url.searchParams.set('state', state);
  url.searchParams.set('scope', OAUTH_SCOPES);
  url.searchParams.set('response_type', 'code');
  return url.toString();
}

interface GraphErrorBody {
  error?: { message?: string; code?: number };
}

async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${META_GRAPH_BASE}/${env.META_GRAPH_VERSION}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const res = await fetch(url.toString());
  const body = (await res.json()) as T & GraphErrorBody;
  if (!res.ok || body.error) {
    throw new Error(`Meta Graph ${path} failed: ${body.error?.message ?? res.status}`);
  }
  return body;
}

/** Exchanges the dialog's `code` for a short-lived USER access token. */
export async function exchangeCodeForToken(code: string): Promise<string> {
  if (!env.META_APP_ID) throw new Error('META_APP_ID is not configured.');
  const data = await graphGet<{ access_token: string }>('/oauth/access_token', {
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    redirect_uri: metaRedirectUri(),
    code,
  });
  return data.access_token;
}

/** Short-lived (~1-2h) USER token → long-lived (~60d) USER token. */
export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<string> {
  if (!env.META_APP_ID) throw new Error('META_APP_ID is not configured.');
  const data = await graphGet<{ access_token: string }>('/oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    fb_exchange_token: shortLivedToken,
  });
  return data.access_token;
}

export interface ManagedPage {
  id: string;
  name: string;
  accessToken: string;
}

/**
 * Pages the OAuth'd user manages, with their PAGE tokens — what
 * services/meta/send.ts actually sends messages with, never the user token.
 * A Page token minted from a long-lived user token is itself long-lived
 * (Meta's own behavior), so no further exchange is needed here.
 */
export async function fetchManagedPages(userToken: string): Promise<ManagedPage[]> {
  const data = await graphGet<{ data: Array<{ id: string; name: string; access_token: string }> }>(
    '/me/accounts',
    { access_token: userToken },
  );
  return data.data.map((p) => ({ id: p.id, name: p.name, accessToken: p.access_token }));
}

/** The Instagram professional account linked to a Page, if any. */
export async function fetchInstagramAccountId(pageId: string, pageAccessToken: string): Promise<string | null> {
  const data = await graphGet<{ instagram_business_account?: { id: string } }>(`/${pageId}`, {
    fields: 'instagram_business_account',
    access_token: pageAccessToken,
  });
  return data.instagram_business_account?.id ?? null;
}
