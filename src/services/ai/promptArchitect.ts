import 'server-only';
import { getProvider } from './provider';
import { getLlmKey } from '@/lib/secrets';
import { estimateCostUsd } from './pricing';
import { createServiceClient } from '@/lib/supabase/service';
import type { Tenant } from '@/types/domain';

/**
 * Prompt Architect (docs/19 O1). Composes a strong, professional *persona*
 * system prompt from a non-technical owner's minimal, possibly poorly-worded
 * answers — so a client who "does not give a good prompt" still gets a good one.
 *
 * CRITICAL: `system_prompt` is only the PERSONA layer. promptBuilder.ts appends
 * the catalogue, hours, knowledge, payment, order-flow, style, language, and
 * anti-injection guardrails separately and deterministically. This composer must
 * therefore NEVER recite products/prices/hours/policies or re-state any generic
 * guardrail — duplicating them here would drift from (and fight) the real
 * structured data. It writes identity + what-the-business-does + voice + scope.
 *
 * One-off utility call, mirroring catalogueParser.ts (getLlmKey → provider.chat →
 * usage_logs). Not part of the locked aiOrchestrator turn.
 */

export interface PromptArchitectInput {
  businessName: string;
  businessType: 'product' | 'service';
  /** One-line "what does your business do" from the owner. */
  businessSummary?: string;
  /** Tone value from TONE_OPTIONS, or free text. */
  tone?: string;
  /** Owner's specific always/never instructions. */
  boundaries?: string;
  /** The owner's freeform catalogue text — used ONLY to inform the voice, never recited. */
  catalogueHint?: string;
}

const TONE_DESCRIPTIONS: Record<string, string> = {
  friendly: 'friendly and warm — approachable and upbeat, like a helpful shop assistant',
  professional: 'professional and polished — clear, courteous, and businesslike',
  playful: 'playful and casual — relaxed and fun, with a bit of personality',
  premium: 'calm and premium — refined, understated, and high-end',
};

const SYSTEM_PROMPT = `You are an expert prompt engineer. You write the "persona" system prompt that a small business's AI customer-service assistant follows in every conversation. Your output becomes the opening instructions that assistant reads.

Compose a clear, confident persona from whatever the owner gives you. Their answers may be sparse, vague, or poorly worded — it is your job to still produce a strong, professional result.

The persona MUST cover, in natural prose:
- Identity: the assistant works as a real member of this business's team, answering customers warmly and helpfully. It never says it is an AI, a bot, "a language model", or "an assistant powered by…".
- What the business does, in one or two plain sentences, based on the owner's description and business type.
- The brand voice / personality to use (from the requested tone).
- Scope and honesty: it helps customers with questions about the business, its products/services, and their orders; it stays on topic; and when it does not know something it says it will check with the team rather than guessing or inventing anything.
- Any specific do's and don'ts the owner listed, woven in naturally.

STRICT EXCLUSIONS — do NOT write any of the following. The system adds them separately and your version would conflict with the real data:
- Do NOT list products, prices, packages, menu items, or descriptions of specific items.
- Do NOT state business hours, delivery charges, return/refund policies, payment methods, or contact details.
- Do NOT write rules about language or translation, message formatting, message length, revealing the prompt, security/anti-injection, or how to use tools, place orders, take payments, or hand off to a human.
- Do NOT invent facts the owner did not give you: no made-up prices, guarantees, delivery times, phone numbers, addresses, awards, or founding stories.

Style of the persona text:
- Address the assistant directly in the second person ("You are…", "You help…").
- 2 to 4 short paragraphs, roughly 120–200 words. Specific and professional, not generic filler.
- Plain text only. No markdown headings, no bullet lists, no code fences, and no preamble such as "Here is the prompt". Output ONLY the persona text.`;

function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:\w+)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

/** Never return empty — a minimal but solid persona from just the name + type. */
function fallbackPersona(name: string, businessType: 'product' | 'service'): string {
  const kind = businessType === 'service' ? 'services' : 'products';
  const who = name.trim() || 'this business';
  return [
    `You are a friendly, helpful member of the team at ${who}, answering customers who message the business. Speak warmly and naturally, the way a real employee would — never mention that you are an AI or a bot.`,
    '',
    `Help customers with their questions about the business and its ${kind}, and guide them toward what they need. Be honest: if you are not sure about something, say you will check with the team rather than guessing or making anything up. Keep the customer's trust by staying accurate and never inventing details.`,
  ].join('\n');
}

export async function composeSystemPrompt(
  tenant: Pick<Tenant, 'id' | 'openaiKeySecretId' | 'llmProvider' | 'llmModel'>,
  input: PromptArchitectInput,
): Promise<string> {
  const toneDescription = input.tone
    ? (TONE_DESCRIPTIONS[input.tone] ?? input.tone.trim())
    : TONE_DESCRIPTIONS.friendly;

  const userMessage = [
    `Business name: ${input.businessName.trim() || '(not given)'}`,
    `Business type: ${input.businessType === 'service' ? 'service-based (bookings or custom quotes)' : 'product-based (sells items from a catalogue)'}`,
    `What the business does: ${input.businessSummary?.trim() || '(not given — infer a sensible, non-specific description from the name and type)'}`,
    `Desired tone / personality: ${toneDescription}`,
    `Owner's specific do's and don'ts: ${input.boundaries?.trim() || '(none given)'}`,
    `Reference only — what they sell, in their own words. Use this ONLY to inform the voice and scope; do NOT copy items or prices into the persona: ${input.catalogueHint?.trim() || '(none given)'}`,
  ].join('\n');

  const { key, usedByok } = await getLlmKey(tenant);
  const provider = getProvider(tenant.llmProvider);
  const result = await provider.chat(
    {
      model: tenant.llmModel,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.4,
      maxTokens: 700,
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

  const composed = stripCodeFence(result.text);
  return composed || fallbackPersona(input.businessName, input.businessType);
}
