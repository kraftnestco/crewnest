import 'server-only';
import { getProvider } from './provider';
import { getLlmKey } from '@/lib/secrets';
import { estimateCostUsd } from './pricing';
import { createServiceClient } from '@/lib/supabase/service';
import type { Tenant } from '@/types/domain';
import type { Json } from '@/types/database';

/**
 * Converts a client's plain-language catalogue description into the structured
 * JSON promptBuilder/knowledge.ts already expect (docs/13 §9 follow-up: clients
 * are non-technical and must never see/write raw JSON — only admins do, via the
 * existing intake JSON textarea). One-off utility call, not part of the locked
 * aiOrchestrator turn — safe to add without an [OPUS] pass.
 */

const SYSTEM_PROMPT = `You convert a small-business owner's plain-language description of what they sell into a JSON array. Output ONLY a JSON array, no prose, no markdown fences.

Each array item is an object with:
- "name": short item/service/package name (string, required)
- "description": what it is, in the owner's own words (string, optional)
- "price": price or price range exactly as stated, or omitted if not mentioned (string, optional)

Preserve every distinct item, price, and policy the owner mentions — do not invent or drop anything. If something doesn't fit an item (e.g. a general policy like "free delivery over $50"), still include it as its own array entry with a descriptive name.`;

function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

/** Falls back to a single passthrough item so a malformed model response never loses the owner's text. */
function safeParseCatalogueJson(text: string, fallbackSource: string): Json {
  try {
    const parsed: unknown = JSON.parse(stripCodeFence(text));
    if (Array.isArray(parsed)) return parsed as Json;
  } catch {
    // fall through to fallback below
  }
  return [{ name: 'Catalogue', description: fallbackSource.trim() }] as Json;
}

export async function parseCatalogueFreeform(
  tenant: Pick<Tenant, 'id' | 'openaiKeySecretId' | 'llmProvider' | 'llmModel'>,
  freeformText: string,
): Promise<Json> {
  const trimmed = freeformText.trim();
  if (!trimmed) return [];

  const { key, usedByok } = await getLlmKey(tenant);
  const provider = getProvider(tenant.llmProvider);
  const result = await provider.chat(
    {
      model: tenant.llmModel,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: trimmed },
      ],
      temperature: 0,
      maxTokens: 2000,
    },
    key,
  );

  const client = createServiceClient();
  await client.from('usage_logs').insert({
    tenant_id: tenant.id,
    session_id: null,
    provider: tenant.llmProvider,
    model: tenant.llmModel,
    prompt_tokens: result.usage.promptTokens,
    completion_tokens: result.usage.completionTokens,
    total_tokens: result.usage.totalTokens,
    estimated_cost_usd: estimateCostUsd(result.usage, tenant.llmModel),
    used_byok: usedByok,
  });

  return safeParseCatalogueJson(result.text, trimmed);
}
