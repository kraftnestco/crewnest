import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { getEmbeddingKey } from '@/lib/secrets';
import { embedTexts, EMBEDDING_MODEL } from './ai/embed';
import { estimateCostUsd } from './ai/pricing';
import { RETRIEVAL_TOP_K, RETRIEVED_CONTEXT_TOKEN_BUDGET } from '@/lib/constants';
import type { Tenant } from '@/types/domain';

/**
 * Stage N (docs/12 §5) — pgvector ingestion + query-time retrieval, built against
 * the N1 [OPUS] decision frozen in docs/12 §5.5. Triggered only for a tenant whose
 * catalogue or knowledge base trips the per-source budget (promptBuilder §5.5.7);
 * every other tenant never calls into this file.
 */

const CHARS_PER_TOKEN_ESTIMATE = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface ChunkInput {
  source: 'catalogue' | 'knowledge';
  sourceRef: string | null;
  content: string;
}

/** One chunk per top-level catalogue entry (§5.5.1) — content fed to the model verbatim on retrieval. */
function chunkCatalogue(catalogData: unknown): ChunkInput[] {
  if (Array.isArray(catalogData)) {
    return catalogData
      .map((item, i): ChunkInput => {
        const ref = isRecord(item) && typeof item.name === 'string' ? item.name : `item-${i}`;
        return { source: 'catalogue', sourceRef: ref, content: JSON.stringify(item) };
      })
      .filter((c) => c.content && c.content !== '{}' && c.content !== 'null');
  }
  if (isRecord(catalogData)) {
    return Object.entries(catalogData)
      .map(([key, value]): ChunkInput => ({ source: 'catalogue', sourceRef: key, content: JSON.stringify(value) }))
      .filter((c) => c.content && c.content !== '{}' && c.content !== 'null');
  }
  return [];
}

/** One chunk per FAQ entry + one per policy field (§5.5.1) — self-contained, no overlap. */
function chunkKnowledgeBase(knowledgeBase: unknown): ChunkInput[] {
  if (!isRecord(knowledgeBase)) return [];
  const chunks: ChunkInput[] = [];

  const faq = Array.isArray(knowledgeBase.faq) ? knowledgeBase.faq : [];
  faq.forEach((entry, i) => {
    if (isRecord(entry) && typeof entry.q === 'string' && typeof entry.a === 'string' && entry.q && entry.a) {
      chunks.push({ source: 'knowledge', sourceRef: `faq-${i}`, content: `Q: ${entry.q}  A: ${entry.a}` });
    }
  });

  for (const field of ['delivery', 'returns', 'location', 'note'] as const) {
    const value = knowledgeBase[field];
    if (typeof value === 'string' && value.trim()) {
      chunks.push({ source: 'knowledge', sourceRef: field, content: value.trim() });
    }
  }

  return chunks;
}

/**
 * Re-embeds a tenant's catalogue + knowledge base into `knowledge_chunks` (§5.2).
 * Clean re-embed: prior chunks for these sources are dropped first. Called from
 * `after()` on intake save — never blocks the save, never throws into the caller's
 * request path (best-effort, logged on failure).
 */
export async function ingestTenantKnowledge(
  tenant: Pick<Tenant, 'id' | 'openaiKeySecretId'>,
  catalogData: unknown,
  knowledgeBase: unknown,
): Promise<void> {
  const client = createServiceClient();
  const chunks = [...chunkCatalogue(catalogData), ...chunkKnowledgeBase(knowledgeBase)];

  const { error: delError } = await client
    .from('knowledge_chunks')
    .delete()
    .eq('tenant_id', tenant.id)
    .in('source', ['catalogue', 'knowledge']);
  if (delError) throw delError;

  if (!chunks.length) return;

  const { key, usedByok } = await getEmbeddingKey(tenant);
  const { embeddings, usage } = await embedTexts(
    chunks.map((c) => c.content),
    key,
  );

  const rows = chunks.map((c, i) => ({
    tenant_id: tenant.id,
    source: c.source,
    source_ref: c.sourceRef,
    content: c.content,
    embedding: embeddings[i] as unknown as string,
    token_count: estimateTokens(c.content),
  }));
  const { error: insError } = await client.from('knowledge_chunks').insert(rows);
  if (insError) throw insError;

  await client.from('usage_logs').insert({
    tenant_id: tenant.id,
    session_id: null,
    provider: 'openai',
    model: EMBEDDING_MODEL,
    prompt_tokens: usage.promptTokens,
    completion_tokens: 0,
    total_tokens: usage.totalTokens,
    estimated_cost_usd: estimateCostUsd(usage, EMBEDDING_MODEL),
    used_byok: usedByok,
  });
}

/**
 * Query-time retrieval (§5.3) — embeds the user turn, pulls top-k chunks via the
 * service-role-only `match_knowledge_chunks` RPC (tenant filter baked in, §5.5.4),
 * and trims to the token budget. Returns null when nothing is retrievable so the
 * caller injects no extra dynamic-tail message.
 */
export async function retrieveContext(
  tenant: Pick<Tenant, 'id' | 'openaiKeySecretId'>,
  queryText: string,
  sessionId: string | null,
): Promise<string | null> {
  if (!queryText.trim()) return null;

  const { key, usedByok } = await getEmbeddingKey(tenant);
  const { embeddings, usage } = await embedTexts([queryText], key);
  const queryEmbedding = embeddings[0];

  const client = createServiceClient();

  await client.from('usage_logs').insert({
    tenant_id: tenant.id,
    session_id: sessionId,
    provider: 'openai',
    model: EMBEDDING_MODEL,
    prompt_tokens: usage.promptTokens,
    completion_tokens: 0,
    total_tokens: usage.totalTokens,
    estimated_cost_usd: estimateCostUsd(usage, EMBEDDING_MODEL),
    used_byok: usedByok,
  });

  if (!queryEmbedding) return null;

  const { data, error } = await client.rpc('match_knowledge_chunks', {
    p_tenant: tenant.id,
    p_query: queryEmbedding as unknown as string,
    p_k: RETRIEVAL_TOP_K,
  });
  if (error) throw error;

  const chunks = data ?? [];
  if (!chunks.length) return null;

  const parts: string[] = [];
  let usedTokens = 0;
  for (const chunk of chunks) {
    const tokens = estimateTokens(chunk.content);
    if (parts.length > 0 && usedTokens + tokens > RETRIEVED_CONTEXT_TOKEN_BUDGET) break;
    parts.push(`- ${chunk.content}`);
    usedTokens += tokens;
  }
  if (!parts.length) return null;

  return ['## RETRIEVED CONTEXT (reference data)', ...parts].join('\n');
}
