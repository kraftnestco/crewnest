import 'server-only';
import { env } from '@/lib/env';
import { META_GRAPH_BASE } from '@/lib/constants';
import { getMetaToken } from '@/lib/secrets';
import type { Platform, Tenant } from '@/types/domain';

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
    return { ok: res.ok, status: res.status };
  }

  // Messenger (facebook) and Instagram both post to {page_id}/messages with the page token.
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
  return { ok: res.ok, status: res.status };
}
