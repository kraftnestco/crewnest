/**
 * Provider-agnostic LLM abstraction. Tenants pick a provider (`tenant.llm_provider`);
 * the orchestrator only ever imports this interface + `getProvider()`, so switching
 * providers is a config change, not a code change. See docs/05-AI-PIPELINE.md §3.
 */

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface LlmRequest {
  model: string;
  messages: LlmMessage[];
  /**
   * Number of leading messages that form the cacheable static prefix
   * (system_prompt + catalogue + guardrails). Providers with explicit caching
   * (e.g. Anthropic) mark up to this boundary; OpenAI caches automatically.
   */
  cachePrefixLength?: number;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmResult {
  text: string;
  usage: LlmUsage;
  raw?: unknown;
}

export interface LlmProvider {
  readonly id: string;
  /** Perform one chat completion. `apiKey` is passed in (never read from env here). */
  chat(req: LlmRequest, apiKey: string): Promise<LlmResult>;
}

import { openAiProvider } from './openai';

/**
 * Factory. Add providers here as they are implemented.
 * NOTE: for Anthropic, load the `claude-api` skill before implementing (model ids,
 * cache_control, pricing) — see docs/08-IMPLEMENTATION-GUIDE.md §10.
 */
export function getProvider(id: string): LlmProvider {
  switch (id) {
    case 'openai':
      return openAiProvider;
    default:
      throw new Error(`Unknown LLM provider: ${id}`);
  }
}
