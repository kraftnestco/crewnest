/**
 * aiOrchestrator — the brain. Turns one inbound message into a grounded,
 * on-brand reply, safely and cheaply. Implements docs/05-AI-PIPELINE.md §1.
 *
 * Trigger-agnostic ON PURPOSE: it imports no `next/*` and no `server-only`, so it
 * can be driven by the Meta webhook's after(), the website widget route, OR a
 * future pgmq consumer — without changes. The leaf services it calls enforce the
 * server-only / service-role boundary.
 */
import * as tenants from './tenants';
import * as sessions from './sessions';
import * as messages from './messages';
import * as mediaIntake from './mediaIntake';
import * as promptBuilder from './ai/promptBuilder';
import * as knowledge from './knowledge';
import { computeOpenNow } from './hours';
import { getProvider } from './ai/provider';
import type { LlmMessage } from './ai/provider';
import { estimateCostUsd } from './ai/pricing';
import { getEnabledTools, executeTool } from './tools/registry';
import { getLlmKey } from '@/lib/secrets';
import { sendText } from './meta/send';
import {
  sanitizeInbound,
  stripHandoffToken,
  assistantRequestedHandoff,
  extractSignal,
  stripSignalTokens,
} from './security/sanitize';
import { MEMORY_TOKEN_BUDGET, MAX_TOOL_ROUNDS } from '@/lib/constants';
import type { InboundMessage } from '@/types/domain';

export interface OrchestratorResult {
  sessionId: string;
  /** The reply to show/send; null when muted (handoff) or dropped. */
  replyText: string | null;
  handoff: boolean;
}

export async function handleInboundMessage(
  input: InboundMessage,
): Promise<OrchestratorResult | null> {
  // 1. Resolve tenant from the destination (widget key for web, routing id otherwise).
  const tenant =
    input.platform === 'web'
      ? await tenants.resolveByWidgetKey(input.destinationId)
      : await tenants.resolveByDestination(input.platform, input.destinationId);

  if (!tenant) {
    console.warn('[orchestrator] no active tenant for destination', {
      platform: input.platform,
    });
    return null;
  }

  // 2. Session (one per customer per channel).
  const session = await sessions.findOrCreate(
    tenant.id,
    input.platform,
    input.externalUserId,
  );

  // 3. Sanitise untrusted customer text (prompt-injection guardrail).
  let userText = sanitizeInbound(input.text);

  // 3b. Inbound media (docs/10 §4/§5/§6.1) — download/transcribe, then fold any
  // caption/transcript/system note into the turn's text. Images ride separately
  // as `media.imageUrls` (attached to the prompt below, never persisted as text).
  const media = await mediaIntake.processInboundMedia(input.attachments, tenant, session);
  if (media.extraText) {
    userText = userText ? `${userText}\n${media.extraText}` : media.extraText;
  }

  // 4. Handoff gate — hard stop. Persist so a human sees it in the inbox; no LLM.
  if (session.isHumanHandoff) {
    await messages.persist({
      sessionId: session.id,
      tenantId: tenant.id,
      role: 'user',
      content: userText,
      providerMsgId: input.providerMsgId,
      attachments: media.attachments,
    });
    return { sessionId: session.id, replyText: null, handoff: true };
  }

  // 5. Persist the inbound user message.
  await messages.persist({
    sessionId: session.id,
    tenantId: tenant.id,
    role: 'user',
    content: userText,
    providerMsgId: input.providerMsgId,
    attachments: media.attachments,
  });

  // 6. Short-term memory (chronological, token-budgeted).
  const history = await messages.loadWindow(session.id, MEMORY_TOKEN_BUDGET);

  // 7. Cache-ordered prompt: [static prefix] ++ history ++ new user msg (+ images, §4.2).
  const built = promptBuilder.build({ tenant, history, userText, imageUrls: media.imageUrls });

  // 7b. Dynamic "open now" line — server-computed, injected AFTER the cache prefix so it
  // never touches the byte-identical static block (docs/12 §4.3). Only emitted when the
  // tenant has configured hours.
  const openNow = computeOpenNow(tenant.businessHours, tenant.timezone);
  if (openNow) {
    built.messages.splice(built.cachePrefixLength, 0, {
      role: 'system',
      content: `[context] Current local time for this business: ${openNow.localTimeLabel} (${tenant.timezone}). The business is currently ${openNow.isOpen ? 'OPEN' : 'CLOSED'}.`,
    });
  }

  // 7c. Stage-N retrieval (docs/12 §5.3) — only when the catalogue or knowledge base
  // outgrew the stuffed prefix (promptBuilder §5.5.7). Rides the dynamic tail, same
  // seam as the open-now line, so the static prefix stays byte-identical.
  if (built.retrievalNeeded) {
    const retrieved = await knowledge.retrieveContext(tenant, userText, session.id);
    if (retrieved) {
      built.messages.splice(built.cachePrefixLength, 0, { role: 'system', content: retrieved });
    }
  }

  // 8. Resolve the LLM key (tenant BYOK from Vault, else master fallback).
  const { key, usedByok } = await getLlmKey(tenant);

  // 9. Bounded tool-calling loop (docs/09-ORDERS-AND-TOOLS.md §2.3). A tenant with
  // no enabled tools gets an empty list, which behaves identically to the old
  // single-call path (provider.chat with tools: undefined).
  const provider = getProvider(tenant.llmProvider);
  const tools = getEnabledTools(tenant);
  const conversation: LlmMessage[] = [...built.messages];
  let finalText = '';
  let finalCompletionTokens = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await provider.chat(
      {
        model: tenant.llmModel,
        messages: conversation,
        cachePrefixLength: built.cachePrefixLength,
        tools: tools.length ? tools.map((t) => t.def) : undefined,
      },
      key,
    );
    // NOTE: `key` is intentionally not referenced again and never logged.

    // Metering — every round is a billable call, so log each one.
    await messages.logUsage({
      tenantId: tenant.id,
      sessionId: session.id,
      provider: provider.id,
      model: tenant.llmModel,
      usage: result.usage,
      usedByok,
      costUsd: estimateCostUsd(result.usage, tenant.llmModel),
    });

    if (result.toolCalls?.length) {
      conversation.push({ role: 'assistant', content: result.text ?? '', toolCalls: result.toolCalls });
      for (const call of result.toolCalls) {
        // Identity (tenant/session) and this turn's media come from the server-side
        // ToolContext, never from the model's arguments — see services/tools/registry.ts.
        const toolResult = await executeTool(call, { tenant, session, attachments: media.attachments });
        conversation.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(toolResult) });
      }
      continue; // let the model see the tool results and produce the next turn
    }

    finalText = result.text;
    finalCompletionTokens = result.usage.completionTokens;
    break; // plain-text turn ⇒ done
  }

  // Round cap exhausted with no plain-text turn (e.g. tool args kept failing
  // validation) — hand off rather than leaving the customer without a reply.
  if (!finalText) {
    await sessions.setHandoff(session.id, true);
    return { sessionId: session.id, replyText: null, handoff: true };
  }

  // 10. Handoff detection — honoured ONLY from assistant output.
  const handoff = assistantRequestedHandoff(finalText);
  const replyText = stripSignalTokens(stripHandoffToken(finalText));

  // 10b. Live Inbox alert signal (docs/08 GUARDRAIL_RULES) — sticky until a human
  // acts on it; only ever SET here, never auto-cleared by a calmer follow-up turn,
  // so a flagged conversation can't quietly drop off staff's radar.
  const signal = extractSignal(finalText);
  if (signal) {
    await sessions.setAlertSignal(session.id, signal);
  }

  if (handoff) {
    await sessions.setHandoff(session.id, true);
    // Do not auto-reply; a human takes over. Inbox turns red via realtime.
    return { sessionId: session.id, replyText: null, handoff: true };
  }

  // 11. Persist the assistant reply.
  await messages.persist({
    sessionId: session.id,
    tenantId: tenant.id,
    role: 'assistant',
    content: replyText,
    tokenCount: finalCompletionTokens,
  });

  // 12. Dispatch. Web widget returns the text in its HTTP response instead of sending.
  if (input.platform !== 'web') {
    await sendText({
      tenant,
      platform: input.platform,
      to: input.externalUserId,
      text: replyText,
    });
  }

  return { sessionId: session.id, replyText, handoff: false };
}
