import 'server-only';
import { getProvider } from '@/services/ai/provider';
import type { LlmMessage, LlmUsage } from '@/services/ai/provider';
import { getLlmKey } from '@/lib/secrets';
import { estimateCostUsd } from '@/services/ai/pricing';
import { createServiceClient } from '@/lib/supabase/service';
import type { Tenant } from '@/types/domain';
import { log } from '@/lib/log';
import {
  buildCopilotDraft,
  describeSnapshot,
  executeCopilotTool,
  getCopilotToolDefs,
} from './copilotTools';
import { patchHasMoneyChange, type CopilotMessage, type CopilotPatch } from './tiers';
import type { CopilotAction } from './actions';

/**
 * Business Copilot turn runner (docs/19 O5). Builds a system prompt from the
 * tier rules + a snapshot of the tenant's CURRENT editable profile, then runs a
 * BOUNDED tool-calling loop where every tool only stages change into an in-memory
 * draft (no DB writes). Returns the assistant's reply plus the staged `patch` the
 * UI previews and the apply action commits. Mirrors the one-off utility pattern
 * (getLlmKey → provider.chat → usage_logs) but loops, so usage is summed and
 * logged once at the end.
 *
 * This is DB-read-only w.r.t. tenant data. The only write is the usage_logs row.
 */

export interface CopilotTurnResult {
  reply: string;
  patch: CopilotPatch;
  action?: CopilotAction;
  warnings: string[];
  hasMoneyChange: boolean;
}

const MAX_STEPS = 6;
const MAX_HISTORY = 20;
const TEMPERATURE = 0.3;
const MAX_TOKENS = 1200;

/** Today's date (YYYY-MM-DD) in the tenant's timezone, for relative holiday dates. */
function todayInTz(timezone: string | null): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone ?? 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // fall through to UTC
  }
  return new Date().toISOString().slice(0, 10);
}

function buildSystemPrompt(businessName: string, snapshot: string, timezone: string | null): string {
  return `You are the Business Copilot for "${businessName}" inside CrewNest — the dashboard a small-business owner uses to run their AI customer-service assistant. The owner is NON-TECHNICAL. They tell you, in plain language, what changed about their business, and you prepare the exact profile update by calling tools.

Today is ${todayInTz(timezone)} in the business's timezone (${timezone ?? 'not set'}).

HOW YOU WORK — propose, never assert:
- You do NOT save anything. Each tool call STAGES a change the owner reviews and applies with one tap. Never say a change is "done", "saved", or "live". Say things like "I've prepared this — review it and tap Apply."
- Call a tool for every concrete change the owner asks for. If nothing needs changing (they're just asking a question), answer in plain words without calling a tool.
- If a request is ambiguous or missing a key detail (e.g. a price, a date, which days), ask ONE short clarifying question instead of guessing. Never invent prices, dates, or policies.
- When editing the catalogue, always pass the COMPLETE revised catalogue (current items + your edit), never just the new line.
- Keep replies short, warm, and jargon-free. Plain text only — no markdown, no bullet symbols, no code blocks.

WHAT YOU CAN CHANGE (you have tools for these): the assistant's persona/voice, the catalogue, business facts & FAQ (delivery, returns, location, notes), weekly opening hours, holiday closures, business basics (product/service, booking link, timezone), custom-order settings, how photos and voice notes are handled, and payment settings. You can also read the owner's website/social link to import details.

ACTIONS you can propose (separate from a profile edit — each also needs the owner's tap to Apply): inviting a teammate by email, setting an item's exact stock count, and adding units to an item's stock (restock). You may stage at most ONE action per reply — if the owner asks for several actions in one message, handle the first, tell them you did, and ask them to confirm the next once it's applied.

lookup_customer is READ-ONLY: use it to answer questions about a specific customer (their chats, whether a human took over, and their orders) — it never stages a change.

WHAT YOU CANNOT CHANGE — politely refuse and offer to flag the CrewNest team:
- The AI model or provider the assistant runs on.
- Any API keys, tokens, passwords, or connected accounts (WhatsApp/Facebook/Instagram wiring, payment gateway keys).
- Billing, the plan, spending limits/caps, or turning the account on or off.
- Data-retention settings or anything about other businesses.
If asked for any of those, say you can't change that from here and offer: "I can flag our team to help with that — want me to?" Do not pretend to do it.

MONEY CHANGES: you MAY change payment settings, but they are flagged for the owner as a money change before they apply. Proceed normally.

CURRENT BUSINESS PROFILE (for your reference — do not repeat it back verbatim):
${snapshot}`;
}

export async function runCopilotTurn(
  tenant: Tenant,
  catalogFreeformText: string | null,
  history: CopilotMessage[],
): Promise<CopilotTurnResult> {
  const draft = buildCopilotDraft(tenant, catalogFreeformText);
  const system = buildSystemPrompt(tenant.businessName, describeSnapshot(draft.snapshot), tenant.timezone);

  const trimmed = history.slice(-MAX_HISTORY);
  const messages: LlmMessage[] = [
    { role: 'system', content: system },
    ...trimmed.map((m): LlmMessage => ({ role: m.role, content: m.content })),
  ];

  const tools = getCopilotToolDefs();
  const { key, usedByok } = await getLlmKey(tenant);
  const provider = getProvider(tenant.llmProvider);

  const totalUsage: LlmUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let reply = '';

  for (let step = 0; step < MAX_STEPS; step++) {
    const result = await provider.chat(
      { model: tenant.llmModel, messages, tools, temperature: TEMPERATURE, maxTokens: MAX_TOKENS },
      key,
    );
    totalUsage.promptTokens += result.usage.promptTokens;
    totalUsage.completionTokens += result.usage.completionTokens;
    totalUsage.totalTokens += result.usage.totalTokens;

    if (result.toolCalls?.length) {
      messages.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls });
      for (const call of result.toolCalls) {
        const toolResult = await executeCopilotTool(call, draft);
        messages.push({ role: 'tool', toolCallId: call.id, content: toolResult });
      }
      // If the model also emitted text alongside the tool calls, keep it as a
      // provisional reply in case the loop ends before a clean final turn.
      if (result.text) reply = result.text;
      continue;
    }

    reply = result.text || reply;
    break;
  }

  // Best-effort usage log (never blocks the turn), mirroring the other AI utils.
  try {
    const client = createServiceClient();
    await client.from('usage_logs').insert({
      tenant_id: tenant.id,
      session_id: null,
      provider: tenant.llmProvider,
      model: tenant.llmModel,
      prompt_tokens: totalUsage.promptTokens,
      completion_tokens: totalUsage.completionTokens,
      total_tokens: totalUsage.totalTokens,
      estimated_cost_usd: estimateCostUsd(totalUsage, tenant.llmModel),
      used_byok: usedByok,
    });
  } catch (err) {
    log.error('[copilot] usage log failed', { tenantId: tenant.id, err });
  }

  if (!reply.trim()) {
    reply = Object.keys(draft.patch).length || draft.action
      ? "I've prepared that below — review it and tap Apply."
      : "Tell me what you'd like to change about your business and I'll set it up for you to review.";
  }

  return {
    reply,
    patch: draft.patch,
    action: draft.action,
    warnings: draft.warnings,
    hasMoneyChange: patchHasMoneyChange(draft.patch),
  };
}
