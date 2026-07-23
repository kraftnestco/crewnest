import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { env } from '@/lib/env';
import {
  OPENROUTER_BASE_URL,
  TRANSCRIBE_MODEL_OPENAI,
  TRANSCRIBE_MODEL_OPENROUTER,
} from '@/lib/constants';
import type { Tenant } from '@/types/domain';
import { log } from '@/lib/log';

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
 * Delete a Vault secret outright. A tenant-row cascade drops only the
 * *reference* (the *_secret_id column); the secret itself is orphaned unless
 * explicitly removed this way (docs/17 §4.1, Stage T's eraseTenant).
 */
export async function deleteTenantSecret(secretId: string): Promise<void> {
  const svc = createServiceClient();
  const { error } = await svc.rpc('delete_tenant_secret', { p_secret_id: secretId });
  if (error) throw new Error(`deleteTenantSecret failed: ${error.message}`);
}

/**
 * Resolve the LLM API key for a tenant: the tenant's BYOK key from Vault, or the
 * master fallback. The second element indicates whether BYOK was used (for
 * usage_logs.used_byok).
 */
export async function getLlmKey(
  tenant: Pick<Tenant, 'openaiKeySecretId' | 'llmProvider'>,
): Promise<{ key: string; usedByok: boolean }> {
  if (tenant.openaiKeySecretId) {
    const key = await getTenantSecret(tenant.openaiKeySecretId);
    if (key) return { key, usedByok: true };
    log.warn(`[secrets] BYOK secret ${tenant.openaiKeySecretId} configured but unreadable — falling back to master LLM key`);
  }
  if (tenant.llmProvider === 'openrouter') {
    if (!env.MASTER_OPENROUTER_KEY) {
      throw new Error('Tenant is configured for openrouter but MASTER_OPENROUTER_KEY is not set.');
    }
    return { key: env.MASTER_OPENROUTER_KEY, usedByok: false };
  }
  return { key: env.MASTER_OPENAI_KEY, usedByok: false };
}

export interface TranscriptionConfig {
  apiKey: string;
  /** Set for OpenRouter's OpenAI-compatible endpoint; undefined = OpenAI default base. */
  baseURL?: string;
  model: string;
  usedByok: boolean;
}

/**
 * Resolve the endpoint + key + model for voice-note transcription (docs/10 §5).
 * Provider-aware (as of 2026, OpenRouter has an OpenAI-compatible /audio/transcriptions
 * endpoint): a tenant's own OpenAI BYOK key always uses OpenAI; otherwise an OpenRouter
 * tenant transcribes via OpenRouter's master key (so voice works with NO funded OpenAI
 * key — the master OpenAI key is a placeholder in prod), and everyone else uses the
 * master OpenAI key.
 */
export async function getTranscriptionConfig(
  tenant: Pick<Tenant, 'openaiKeySecretId' | 'llmProvider'>,
): Promise<TranscriptionConfig> {
  if (tenant.openaiKeySecretId) {
    const key = await getTenantSecret(tenant.openaiKeySecretId);
    if (key) return { apiKey: key, model: TRANSCRIBE_MODEL_OPENAI, usedByok: true };
    log.warn(`[secrets] BYOK secret ${tenant.openaiKeySecretId} configured but unreadable — falling back to master transcription`);
  }
  if (tenant.llmProvider === 'openrouter' && env.MASTER_OPENROUTER_KEY) {
    return {
      apiKey: env.MASTER_OPENROUTER_KEY,
      baseURL: OPENROUTER_BASE_URL,
      model: TRANSCRIBE_MODEL_OPENROUTER,
      usedByok: false,
    };
  }
  return { apiKey: env.MASTER_OPENAI_KEY, model: TRANSCRIBE_MODEL_OPENAI, usedByok: false };
}

/**
 * Resolve the API key for OpenAI's embeddings endpoint (docs/12 §5.2). Always OpenAI,
 * independent of the tenant's chat llmProvider (OpenRouter embeddings support is spotty).
 */
export async function getEmbeddingKey(
  tenant: Pick<Tenant, 'openaiKeySecretId'>,
): Promise<{ key: string; usedByok: boolean }> {
  if (tenant.openaiKeySecretId) {
    const key = await getTenantSecret(tenant.openaiKeySecretId);
    if (key) return { key, usedByok: true };
    log.warn(`[secrets] BYOK secret ${tenant.openaiKeySecretId} configured but unreadable — falling back to master OpenAI key`);
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
