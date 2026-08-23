import 'server-only';
import { env } from '@/lib/env';
import { INSTAGRAM_GRAPH_BASE, META_GRAPH_BASE } from '@/lib/constants';
import { getMetaToken } from '@/lib/secrets';
import type { Platform, Tenant } from '@/types/domain';

/**
 * Meta's outside-24h-window error family (docs/15-RELIABILITY-AND-
 * DURABILITY.md §6) — a business-initiated free-form message rejected because
 * it's outside the customer's service window and would need a pre-approved
 * template instead. WhatsApp Cloud API's code for this is 131047; Messenger's
 * analogous "message outside allowed window" is its own error #10 family.
 * Checked by CODE, not by string-matching `message` (Meta's wording can
 * change; the numeric code is the stable contract).
 */
const META_WINDOW_ERROR_CODES = new Set([131047, 10]);

/** Thrown by sendText specifically for the outside-window case, distinguishable via `instanceof` so callers (docs/15 §6) can surface-not-lose the reply instead of treating it like any other send failure. */
export class MetaWindowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaWindowError';
  }
}

async function throwForFailedResponse(res: Response): Promise<never> {
  const bodyText = await res.text();
  let code: number | undefined;
  try {
    const parsed = JSON.parse(bodyText) as { error?: { code?: number; error_subcode?: number } };
    code = parsed.error?.code ?? parsed.error?.error_subcode;
  } catch {
    // Non-JSON error body — fall through to the generic error below.
  }
  if (code !== undefined && META_WINDOW_ERROR_CODES.has(code)) {
    throw new MetaWindowError(`Meta send rejected — outside 24h window (code ${code}): ${bodyText.slice(0, 300)}`);
  }
  throw new Error(`Meta send failed (${res.status}): ${bodyText.slice(0, 300)}`);
}

/**
 * Send an outbound text reply on the same Meta channel, using the tenant's
 * decrypted token (resolved from Vault in memory here). See docs/06-INTEGRATIONS.md §1.3.
 * Logs metadata only — never the token or full message body.
 */
export async function sendText(args: {
  tenant: Tenant;
  platform: Platform;
  to: string; // external user id / phone number
  text: string;
}): Promise<{ ok: boolean; status: number }> {
  const { tenant, platform, to, text } = args;
  const version = env.META_GRAPH_VERSION;

  if (platform === 'whatsapp') {
    const token = await getMetaToken(tenant, 'whatsapp');
    if (!token || !tenant.whatsappPhoneNumberId) {
      throw new Error(`No WhatsApp token/phone id for tenant ${tenant.id}`);
    }
    const url = `${META_GRAPH_BASE}/${version}/${tenant.whatsappPhoneNumberId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    });
    if (!res.ok) await throwForFailedResponse(res);
    return { ok: res.ok, status: res.status };
  }

  // Instagram connected standalone (no Facebook Page — "Connect with
  // Instagram", Instagram Business Login) sends via graph.instagram.com with
  // an Instagram User token, keyed on the IG account id itself, not a Page.
  if (platform === 'instagram' && tenant.instagramTokenSecretId) {
    const token = await getMetaToken(tenant, 'instagram');
    if (!token || !tenant.instagramId) {
      throw new Error(`No Instagram token/id for tenant ${tenant.id}`);
    }
    const url = `${INSTAGRAM_GRAPH_BASE}/${version}/${tenant.instagramId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: to },
        message: { text },
      }),
    });
    if (!res.ok) await throwForFailedResponse(res);
    return { ok: res.ok, status: res.status };
  }

  // Messenger (facebook), and Instagram when connected via the Facebook-Page-
  // linked flow instead of standalone above, both post to {page_id}/messages
  // with the page token.
  const token = await getMetaToken(tenant, 'meta');
  if (!token || !tenant.metaPageId) {
    throw new Error(`No Meta page token/id for tenant ${tenant.id}`);
  }
  const url = `${META_GRAPH_BASE}/${version}/${tenant.metaPageId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: to },
      messaging_type: 'RESPONSE',
      message: { text },
    }),
  });
  if (!res.ok) await throwForFailedResponse(res);
  return { ok: res.ok, status: res.status };
}

/**
 * Send an owner-notification WhatsApp template (business-initiated, outside any
 * customer 24h window — must be a pre-approved template). See docs/09 §4.1-4.2.
 * `templateName` is `tenant.ownerNotifyTemplate`; approval is an ops step, not code.
 */
export async function sendTemplate(args: {
  tenant: Tenant;
  to: string; // owner's WhatsApp number, E.164
  templateName: string;
  bodyParams: string[];
}): Promise<{ ok: boolean; status: number }> {
  const { tenant, to, templateName, bodyParams } = args;
  const version = env.META_GRAPH_VERSION;

  const token = await getMetaToken(tenant, 'whatsapp');
  if (!token || !tenant.whatsappPhoneNumberId) {
    throw new Error(`No WhatsApp token/phone id for tenant ${tenant.id}`);
  }
  const url = `${META_GRAPH_BASE}/${version}/${tenant.whatsappPhoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'en' },
        components: [{ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) }],
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Meta template send failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  return { ok: res.ok, status: res.status };
}
