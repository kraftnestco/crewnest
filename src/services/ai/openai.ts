import OpenAI from 'openai';
import type { LlmProvider, LlmRequest, LlmResult } from './provider';

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

    const completion = await client.chat.completions.create({
      model: req.model,
      // Phase 1 only sends system/user/assistant; cast satisfies the SDK's
      // discriminated union (which requires extra fields for 'tool' messages).
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })) as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      temperature: req.temperature ?? 0.4,
      max_tokens: req.maxTokens ?? 800,
    });

    const choice = completion.choices[0];
    const usage = completion.usage;

    return {
      text: choice?.message?.content?.trim() ?? '',
      usage: {
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
      },
      raw: completion,
    };
  },
};
