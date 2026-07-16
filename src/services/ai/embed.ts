import 'server-only';
import OpenAI from 'openai';
import type { LlmUsage } from './provider';

/**
 * Embeddings for Stage-N retrieval (docs/12 §5.5.2) — always OpenAI, independent
 * of the tenant's chat llmProvider (same rule as transcribe.ts).
 */

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

export interface EmbedResult {
  embeddings: number[][];
  usage: LlmUsage;
}

export async function embedTexts(texts: string[], apiKey: string): Promise<EmbedResult> {
  if (!texts.length) return { embeddings: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };

  const client = new OpenAI({ apiKey });
  const result = await client.embeddings.create({ model: EMBEDDING_MODEL, input: texts });

  return {
    embeddings: result.data.map((d) => d.embedding),
    usage: {
      promptTokens: result.usage.prompt_tokens,
      completionTokens: 0,
      totalTokens: result.usage.total_tokens,
    },
  };
}
