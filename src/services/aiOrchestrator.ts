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
import * as orders from './orders';
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
import { notifyBoth } from '@/services/notifications';
import {
  sanitizeInbound,
  stripHandoffToken,
  assistantRequestedHandoff,
  extractSignal,
  stripSignalTokens,
} from './security/sanitize';
import { MEMORY_TOKEN_BUDGET, MAX_TOOL_ROUNDS, FREE_PLAN_DAILY_SESSION_CAP } from '@/lib/constants';
import type { ChatSession, InboundMessage, OrderAttachment, Tenant } from '@/types/domain';

export interface OrchestratorResult {
  /** Null only when a free-plan tenant's daily new-conversation cap blocked the session itself. */
  sessionId: string | null;
  /** The reply to show/send; null when muted (handoff) or dropped. */
  replyText: string | null;
  handoff: boolean;
}

/** Shown to the customer, and returned to the web widget, when Phase D's free-plan cap blocks a NEW conversation. */
const FREE_PLAN_LIMIT_REACHED_TEXT =
  "Thanks for reaching out! We've reached today's conversation limit on our free plan — please try again tomorrow, or the business will get back to you soon.";

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

  // 2. Session (one per customer per channel). Free-plan tenants cap NEW
  // conversations/day (docs: self-serve signup plan, Phase D); existing
  // sessions are unaffected — see sessions.findOrCreate's doc comment.
  const sessionOrCap = await sessions.findOrCreate(
    tenant.id,
    input.platform,
    input.externalUserId,
    tenant.plan === 'free' ? FREE_PLAN_DAILY_SESSION_CAP : undefined,
  );

  if (sessionOrCap === 'cap_reached') {
    if (input.platform !== 'web') {
      await sendText({
        tenant,
        platform: input.platform,
        to: input.externalUserId,
        text: FREE_PLAN_LIMIT_REACHED_TEXT,
      });
      return { sessionId: null, replyText: null, handoff: false };
    }
    return { sessionId: null, replyText: FREE_PLAN_LIMIT_REACHED_TEXT, handoff: false };
  }
  const session = sessionOrCap;

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

  return runTurn(tenant, session, { userText, imageUrls: media.imageUrls, attachments: media.attachments });
}

interface RunTurnInput {
  /** `null` for a continuation turn with no new customer input (docs: media-handoff plan, B7). */
  userText: string | null;
  imageUrls?: string[];
  attachments?: OrderAttachment[];
}

/**
 * Steps 6–12 of the turn: build the prompt, run the bounded tool-calling loop,
 * detect handoff/signal, persist the reply, and dispatch it. Shared by
 * `handleInboundMessage` (a fresh customer message) and `continueSession` (a
 * human-handoff resolution with no new customer input) — see docs: media-handoff
 * plan, B7. Pure extraction from the original inline steps; behavior-preserving.
 */
async function runTurn(tenant: Tenant, session: ChatSession, { userText, imageUrls, attachments }: RunTurnInput): Promise<OrchestratorResult> {
  // 6. Short-term memory (chronological, token-budgeted).
  const history = await messages.loadWindow(session.id, MEMORY_TOKEN_BUDGET);

  // 6b. Pending post-fulfillment review (docs: order-event-messaging plan, Phase B) — only
  // built when the order still needs a rating; submitReview.ts clears the pointer on
  // success, but re-checking reviewSubmittedAt here guards a stale pointer surviving a
  // crash mid-turn.
  let pendingReview: { orderId: string; itemsSummary: string } | undefined;
  if (session.pendingReviewOrderId) {
    const reviewOrder = await orders.getById(session.pendingReviewOrderId);
    if (reviewOrder && !reviewOrder.reviewSubmittedAt) {
      const itemsSummary = reviewOrder.items.map((i) => `${i.name} x${i.qty}`).join(', ') || 'their order';
      pendingReview = { orderId: reviewOrder.id, itemsSummary };
    }
  }

  // 7. Cache-ordered prompt: [static prefix] ++ history ++ new user msg (+ images, §4.2).
  const built = promptBuilder.build({ tenant, history, userText, imageUrls, pendingReview });

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
  // seam as the open-now line, so the static prefix stays byte-identical. Skipped on a
  // continuation turn (no new customer query to retrieve against).
  if (built.retrievalNeeded && userText) {
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
  const tools = getEnabledTools(tenant, session);
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
        const toolResult = await executeTool(call, { tenant, session, attachments });
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
    await notifyBoth({
      tenantId: tenant.id,
      type: 'handoff',
      entityType: 'session',
      entityId: session.id,
      agency: {
        title: 'Handoff needed',
        body: `${tenant.businessName} — assistant couldn't complete a reply`,
        link: `/admin/chat?session=${session.id}`,
      },
      tenant: {
        title: 'A conversation needs you',
        body: "The assistant couldn't complete a reply",
        link: `/dashboard/chat?session=${session.id}`,
      },
    });
    return { sessionId: session.id, replyText: null, handoff: true };
  }

  // 10. Handoff detection — honoured ONLY from assistant output.
  const handoff = assistantRequestedHandoff(finalText);
  const replyText = stripSignalTokens(stripHandoffToken(finalText));

  // 10b. Live Inbox alert signal (docs/08 GUARDRAIL_RULES) — sticky until a human
  // acts on it; only ever SET here, never auto-cleared by a calmer follow-up turn,
  // so a flagged conversation can't quietly drop off staff's radar. Notify only on
  // the transition (docs/14 §3.3) so a long flagged conversation doesn't spam N
  // identical alerts.
  const signal = extractSignal(finalText);
  if (signal) {
    const changed = await sessions.setAlertSignal(session.id, signal);
    if (changed) {
      const signalLabel = signal.replace(/_/g, ' ');
      await notifyBoth({
        tenantId: tenant.id,
        type: 'alert_signal',
        entityType: 'session',
        entityId: session.id,
        agency: {
          title: 'Conversation flagged',
          body: `${tenant.businessName} — ${signalLabel}`,
          link: `/admin/chat?session=${session.id}`,
        },
        tenant: {
          title: 'A conversation was flagged',
          body: signalLabel,
          link: `/dashboard/chat?session=${session.id}`,
        },
      });
    }
  }

  if (handoff) {
    await sessions.setHandoff(session.id, true);
    await notifyBoth({
      tenantId: tenant.id,
      type: 'handoff',
      entityType: 'session',
      entityId: session.id,
      agency: {
        title: 'Handoff requested',
        body: `${tenant.businessName} — customer asked for a human`,
        link: `/admin/chat?session=${session.id}`,
      },
      tenant: {
        title: 'A customer needs you',
        body: 'They asked to speak with a human',
        link: `/dashboard/chat?session=${session.id}`,
      },
    });
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

  // 12. Dispatch. Web widget returns the text in its HTTP response instead of sending —
  // and for a continuation turn (`continueSession`) on a 'web' session there is no open
  // HTTP response to return it on either, a known/accepted gap (docs: media-handoff plan, B7).
  if (session.platform !== 'web') {
    await sendText({
      tenant,
      platform: session.platform,
      to: session.externalUserId,
      text: replyText,
    });
  }

  return { sessionId: session.id, replyText, handoff: false };
}

/**
 * Resumes a session with no new customer input — e.g. a human resolving a
 * voice/video/image clarification via the inbox panel (docs: media-handoff plan,
 * B7/B8). Persists `note` as a system message, then runs the same tool-calling
 * turn as a fresh customer message would, so the AI can reply immediately without
 * the customer needing to send anything first.
 */
export async function continueSession(sessionId: string, note: string): Promise<OrchestratorResult | null> {
  const session = await sessions.getById(sessionId);
  if (!session) return null;
  const tenant = await tenants.getById(session.tenantId);
  if (!tenant) return null;

  await messages.persist({
    sessionId: session.id,
    tenantId: tenant.id,
    role: 'system',
    content: note,
  });

  return runTurn(tenant, session, { userText: null });
}
