import OpenAI from 'openai';
import type { LlmProvider, LlmRequest, LlmResult } from './provider';

/**
 * OpenRouter — OpenAI-compatible API, so this reuses the official `openai` SDK
 * with a different baseURL. Lets a tenant run on a free-tier model (e.g. for
 * demos) without touching the orchestrator. See docs/05-AI-PIPELINE.md §3.
 */
export const openRouterProvider: LlmProvider = {
  id: 'openrouter',

  async chat(req: LlmRequest, apiKey: string): Promise<LlmResult> {
    const client = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' });

    const completion = await client.chat.completions.create({
      model: req.model,
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
