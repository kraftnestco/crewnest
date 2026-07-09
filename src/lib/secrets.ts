import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { env } from '@/lib/env';
import type { Tenant } from '@/types/domain';

/**
 * BYOK secret access via Supabase Vault. All reads go through the service-role
 * client calling the grant-locked RPCs (docs/03-DATABASE.md §6). Returned values
 * live only in function memory for the current request and must NEVER be logged
 * or persisted. See docs/02-SECURITY.md §2.
 */

/** Store/replace a named secret; returns its Vault uuid (persist on the tenant row). */
export async function setTenantSecret(name: string, value: string): Promise<string> {
  const svc = createServiceClient();
  const { data, error } = await svc.rpc('set_tenant_secret', { p_name: name, p_value: value });
  if (error) throw new Error(`setTenantSecret failed: ${error.message}`);
  return data as unknown as string;
}

/** Read a decrypted secret by Vault uuid. Returns null if not found. */
export async function getTenantSecret(secretId: string): Promise<string | null> {
  const svc = createServiceClient();
  const { data, error } = await svc.rpc('get_tenant_secret', { p_secret_id: secretId });
  if (error) throw new Error(`getTenantSecret failed: ${error.message}`);
  return (data as unknown as string) ?? null;
}

/**
 * Resolve the LLM API key for a tenant: the tenant's BYOK key from Vault, or the
 * master fallback. The second element indicates whether BYOK was used (for
 * usage_logs.used_byok).
 */
export async function getLlmKey(tenant: Pick<Tenant, 'openaiKeySecretId'>): Promise<{ key: string; usedByok: boolean }> {
  if (tenant.openaiKeySecretId) {
    const key = await getTenantSecret(tenant.openaiKeySecretId);
    if (key) return { key, usedByok: true };
  }
  return { key: env.MASTER_OPENAI_KEY, usedByok: false };
}

/** Resolve the Meta channel token (page / whatsapp) for outbound sends. */
export async function getMetaToken(
  tenant: Pick<Tenant, 'metaTokenSecretId' | 'whatsappTokenSecretId'>,
  channel: 'meta' | 'whatsapp',
): Promise<string | null> {
  const secretId = channel === 'whatsapp' ? tenant.whatsappTokenSecretId : tenant.metaTokenSecretId;
  if (!secretId) return null;
  return getTenantSecret(secretId);
}
