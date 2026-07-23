import 'server-only';
import { env } from '@/lib/env';
import { META_GRAPH_BASE } from '@/lib/constants';
import { getMetaToken } from '@/lib/secrets';
import type { Tenant } from '@/types/domain';
import { log } from '@/lib/log';

/**
 * Best-effort Messenger/Instagram profile lookup (docs/06 §1.1) — WhatsApp has
 * no equivalent endpoint (its Cloud API never exposes a customer profile
 * photo to businesses; the display name instead arrives free in the webhook
 * payload's `contacts[]`, parsed in meta/parse.ts).
 *
 * Never throws — a failed/partial lookup returns null so the caller can carry
 * on without an identity rather than blocking the customer turn. Logs
 * metadata only, never the token.
 */
export async function fetchProfile(
  externalUserId: string,
  tenant: Pick<Tenant, 'id' | 'metaTokenSecretId' | 'whatsappTokenSecretId'>,
): Promise<{ name: string | null; avatarUrl: string | null } | null> {
  try {
    const token = await getMetaToken(tenant, 'meta');
    if (!token) return null;

    const url = `${META_GRAPH_BASE}/${env.META_GRAPH_VERSION}/${externalUserId}?fields=name,profile_pic`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;

    const json = (await res.json()) as { name?: string; profile_pic?: string };
    if (!json.name && !json.profile_pic) return null;

    return { name: json.name ?? null, avatarUrl: json.profile_pic ?? null };
  } catch (err) {
    log.warn(`[profile] lookup failed (tenant ${tenant.id}):`, err instanceof Error ? err.message : err);
    return null;
  }
}
