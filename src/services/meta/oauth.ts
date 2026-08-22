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
// Deliberately NO 'business_management' here. That scope is what makes Meta's
// dialog insert a "Choose the Businesses you want to access" step, which
// requires the owner to already have (or create) a Meta Business Portfolio
// before Connect can finish — a hard blocker for a "few clicks, under a
// minute" self-serve flow, and unrelated to what these permissions actually
// need: fetchManagedPages (/me/accounts) and fetchInstagramAccountId
// (/{pageId}?fields=instagram_business_account) only require the pages_*/
// instagram_* scopes below. If a future feature genuinely needs Business
// Manager access, add it back deliberately — don't let it regress here.
const OAUTH_SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
  'instagram_basic',
  'instagram_manage_messages',
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

export const META_WHATSAPP_OAUTH_STATE_COOKIE = 'cn_wa_oauth_state';

const WA_OAUTH_SCOPES = [
  'whatsapp_business_management',
  'whatsapp_business_messaging',
  'business_management',
].join(',');

export function whatsappRedirectUri(): string {
  return `${env.NEXT_PUBLIC_APP_URL}/api/meta/whatsapp/callback`;
}

export function buildWhatsAppAuthorizeUrl(state: string): string {
  if (!env.META_APP_ID) throw new Error('META_APP_ID is not configured.');
  const url = new URL(`${OAUTH_DIALOG_BASE}/${env.META_GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set('client_id', env.META_APP_ID);
  url.searchParams.set('redirect_uri', whatsappRedirectUri());
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  if (env.META_WHATSAPP_CONFIG_ID) {
    url.searchParams.set('config_id', env.META_WHATSAPP_CONFIG_ID);
    url.searchParams.set('override_default_response_type', 'true');
    url.searchParams.set(
      'extras',
      JSON.stringify({ setup: {}, featureType: 'whatsapp_embedded_signup', sessionInfoVersion: '2' }),
    );
  } else {
    url.searchParams.set('scope', WA_OAUTH_SCOPES);
  }
  return url.toString();
}

export async function exchangeWhatsAppCodeForToken(code: string): Promise<string> {
  if (!env.META_APP_ID) throw new Error('META_APP_ID is not configured.');
  const data = await graphGet<{ access_token: string }>('/oauth/access_token', {
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    redirect_uri: whatsappRedirectUri(),
    code,
  });
  return data.access_token;
}

export interface WhatsAppPhoneAsset {
  phoneNumberId: string;
  wabaId: string;
  verifiedName: string | null;
  nameStatus: string | null;
}

async function graphPost(path: string, params: Record<string, string>): Promise<void> {
  const url = new URL(`${META_GRAPH_BASE}/${env.META_GRAPH_VERSION}${path}`);
  const res = await fetch(url.toString(), { method: 'POST', body: new URLSearchParams(params) });
  const body = (await res.json()) as GraphErrorBody;
  if (!res.ok || body.error) {
    throw new Error(`Meta Graph POST ${path} failed: ${body.error?.message ?? res.status}`);
  }
}

/**
 * Resolves a WhatsApp Cloud API phone number from a user/system token minted
 * by Embedded Signup or WhatsApp scopes. First WABA + first phone number wins
 * (same single-destination model as tenants.whatsapp_phone_number_id).
 */
export async function fetchWhatsAppPhoneAsset(userToken: string): Promise<WhatsAppPhoneAsset | null> {
  const businesses = await graphGet<{ data?: Array<{ id: string }> }>('/me/businesses', {
    access_token: userToken,
    fields: 'id',
  }).catch(() => ({ data: [] as Array<{ id: string }> }));

  for (const business of businesses.data ?? []) {
    const wabas = await graphGet<{ data?: Array<{ id: string }> }>(`/${business.id}/owned_whatsapp_business_accounts`, {
      access_token: userToken,
    }).catch(() => ({ data: [] as Array<{ id: string }> }));

    for (const waba of wabas.data ?? []) {
      const phones = await graphGet<{
        data?: Array<{ id: string; verified_name?: string; name_status?: string }>;
      }>(`/${waba.id}/phone_numbers`, { access_token: userToken }).catch(() => ({ data: [] }));

      const phone = phones.data?.[0];
      if (!phone) continue;

      await graphPost(`/${waba.id}/subscribed_apps`, { access_token: userToken }).catch(() => {
        // Already subscribed, or the token cannot subscribe — messaging may still work.
      });

      return {
        phoneNumberId: phone.id,
        wabaId: waba.id,
        verifiedName: phone.verified_name ?? null,
        nameStatus: phone.name_status ?? null,
      };
    }
  }

  return null;
}

export async function fetchWhatsAppNameStatus(
  phoneNumberId: string,
  accessToken: string,
): Promise<{ verifiedName: string | null; nameStatus: string | null } | null> {
  try {
    const data = await graphGet<{ verified_name?: string; name_status?: string }>(`/${phoneNumberId}`, {
      access_token: accessToken,
      fields: 'verified_name,name_status',
    });
    return { verifiedName: data.verified_name ?? null, nameStatus: data.name_status ?? null };
  } catch {
    return null;
  }
}
