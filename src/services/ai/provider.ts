/**
 * Provider-agnostic LLM abstraction. Tenants pick a provider (`tenant.llm_provider`);
 * the orchestrator only ever imports this interface + `getProvider()`, so switching
 * providers is a config change, not a code change. See docs/05-AI-PIPELINE.md §3.
 */

export interface LlmToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema for the args object
}

export interface LlmToolCall {
  id: string; // provider-assigned id; echoed back on the tool-result message
  name: string;
  arguments: string; // RAW JSON string exactly as the model emitted it (parse + validate later)
}

/**
 * A single piece of a multimodal message. Only USER turns ever carry these
 * (docs/10 §2.2): images ride on the dynamic user turn so the cache-critical
 * static prefix (system + catalogue + rules) stays a plain string and
 * byte-identical between turns (docs/05 §2). `imageUrl` is a short-TTL signed
 * Storage URL or a `data:` URI — never a token/CDN url (docs/10 §7).
 */
export type LlmContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; imageUrl: string };

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /**
   * A plain string (every existing call, and ALWAYS for system/assistant/tool
   * turns) or, for a USER turn only, an array of parts carrying image(s)
   * alongside text. Keeping non-user turns string-only preserves the cache
   * contract — see the provider mappers.
   */
  content: string | LlmContentPart[];
  toolCalls?: LlmToolCall[]; // set on an ASSISTANT turn that requests tools
  toolCallId?: string; // set on a TOOL-result turn: which call it answers
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
  tools?: LlmToolDef[]; // omit ⇒ no tool-calling (today's path)
  /**
   * Aborts the in-flight request (docs/23-MESSAGE-BATCHING.md §5.1). Set when a
   * newer customer message has arrived and this turn is about to be superseded —
   * the partial response is discarded and the turn restarts with everything
   * combined. Omitting it behaves exactly as before.
   */
  signal?: AbortSignal;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmResult {
  text: string;
  toolCalls?: LlmToolCall[]; // present when the model wants to call tools (text may be empty)
  usage: LlmUsage;
  raw?: unknown;
}

export interface LlmProvider {
  readonly id: string;
  /** Perform one chat completion. `apiKey` is passed in (never read from env here). */
  chat(req: LlmRequest, apiKey: string): Promise<LlmResult>;
}

import { openAiProvider } from './openai';
import { openRouterProvider } from './openrouter';

/**
 * Factory. Add providers here as they are implemented.
 * NOTE: for Anthropic, load the `claude-api` skill before implementing (model ids,
 * cache_control, pricing) — see docs/08-IMPLEMENTATION-GUIDE.md §10.
 */
export function getProvider(id: string): LlmProvider {
  switch (id) {
    case 'openai':
      return openAiProvider;
    case 'openrouter':
      return openRouterProvider;
    default:
      throw new Error(`Unknown LLM provider: ${id}`);
  }
}
