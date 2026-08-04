import OpenAI from 'openai';
import type { LlmContentPart, LlmMessage, LlmProvider, LlmRequest, LlmResult, LlmToolCall } from './provider';

/**
 * Default provider. Relies on OpenAI's AUTOMATIC prompt caching for long-enough
 * static prefixes — no special flag is needed, we just keep the prefix first and
 * byte-identical (promptBuilder guarantees this). See docs/05-AI-PIPELINE.md §3.
 *
 * The API key is passed in per call (resolved from Vault/BYOK or the master
 * fallback) and never read from env here.
 */
export const openAiProvider: LlmProvider = {
  id: 'openai',

  async chat(req: LlmRequest, apiKey: string): Promise<LlmResult> {
    const client = new OpenAI({ apiKey });

    const completion = await client.chat.completions.create(
      {
        model: req.model,
        messages: req.messages.map(toOpenAiMessage),
        temperature: req.temperature ?? 0.4,
        // 800 -> 400. Measured over 120 real calls: median 169, p95 471. The
        // only turns that approached 800 were runaway ones where the model lost
        // the thread and leaked its own reasoning into the customer reply
        // (observed live 2026-08-04: 'Use check_availability with no args<unk>').
        // A tighter ceiling bounds that damage without touching normal replies.
        max_tokens: req.maxTokens ?? 400,
        tools: req.tools?.map((t) => ({
          type: 'function' as const,
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
      },
      // Supersession (docs/23 §5.1). Undefined ⇒ unchanged behaviour.
      { signal: req.signal },
    );

    const choice = completion.choices[0];
    const usage = completion.usage;
    const toolCalls = choice?.message?.tool_calls
      ?.filter((tc): tc is typeof tc & { type: 'function' } => tc.type === 'function')
      .map((tc): LlmToolCall => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments }));

    return {
      text: choice?.message?.content?.trim() ?? '',
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      usage: {
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
      },
      raw: completion,
    };
  },
};

// NOTE: kept byte-for-byte identical to openrouter.ts's toOpenAiMessage — both
// target the same OpenAI-compatible schema. Change them together. The multimodal
// rule (images only on USER turns) is the cache-ordering contract from docs/10 §2.2.

/** Flatten any content to a plain string (drops images) — for the string-only roles. */
function contentToString(content: string | LlmContentPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is Extract<LlmContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

/** Map user-turn parts to OpenAI's multimodal content array. */
function toOpenAiContent(parts: LlmContentPart[]): OpenAI.Chat.Completions.ChatCompletionContentPart[] {
  return parts.map((p) =>
    p.type === 'text'
      ? { type: 'text' as const, text: p.text }
      : { type: 'image_url' as const, image_url: { url: p.imageUrl } },
  );
}

function toOpenAiMessage(m: LlmMessage): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  if (m.role === 'tool') {
    return { role: 'tool', tool_call_id: m.toolCallId!, content: contentToString(m.content) };
  }
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return {
      role: 'assistant',
      content: contentToString(m.content) || null,
      tool_calls: m.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    };
  }
  // USER turns may carry image parts; system/assistant stay string ⇒ cache prefix untouched.
  if (m.role === 'user' && Array.isArray(m.content)) {
    return { role: 'user', content: toOpenAiContent(m.content) };
  }
  return { role: m.role as 'system' | 'user' | 'assistant', content: contentToString(m.content) };
}
