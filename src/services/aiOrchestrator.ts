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
import * as summarize from './ai/summarize';
import * as knowledge from './knowledge';
import { computeOpenNow } from './hours';
import { getProvider } from './ai/provider';
import type { LlmMessage } from './ai/provider';
import { estimateCostUsd } from './ai/pricing';
import { getEnabledTools, executeTool } from './tools/registry';
import { getLlmKey } from '@/lib/secrets';
import { sendText, MetaWindowError } from './meta/send';
import * as metaProfile from './meta/profile';
import { notify, notifyBoth } from '@/services/notifications';
import {
  sanitizeInbound,
  stripHandoffToken,
  assistantRequestedHandoff,
  detectEscalationKeywords,
  extractSignal,
  stripSignalTokens,
} from './security/sanitize';
import {
  MEMORY_TOKEN_BUDGET,
  MAX_TOOL_ROUNDS,
  FREE_PLAN_DAILY_SESSION_CAP,
  DEFAULT_FREE_MONTHLY_CAP_USD,
  RECENT_IMAGE_REATTACH_WINDOW_MINUTES,
} from '@/lib/constants';
import type { AuthoredBy, ChatSession, InboundMessage, OrderAttachment, Tenant } from '@/types/domain';
import { log } from '@/lib/log';

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

/** Shown when a free-plan, non-BYOK tenant crosses its MONTHLY cost ceiling mid-conversation (docs/18 §3, Stage U-cap). */
const FREE_PLAN_MONTHLY_CAP_REACHED_TEXT =
  "Thanks for your message! This business has reached its monthly limit on our free plan — they'll follow up soon, or can upgrade to keep the AI answering right away.";

/** True if any message carries an image part (vision content) — used for the text-only retry. */
function conversationHasImages(msgs: LlmMessage[]): boolean {
  return msgs.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'));
}

/** Words that plausibly refer to an image, gating whether to re-attach a recent one (below). */
const IMAGE_REFERENCE_RE =
  /\b(pic|picture|photo|image|screenshot|design|attached|sent you|like this|this one|that one|the one i sent)\b/i;

/** Collapse a message's content to text only, dropping image parts (for a text-only retry). */
function stripImageParts(msg: LlmMessage): LlmMessage {
  if (!Array.isArray(msg.content)) return msg;
  const text = msg.content
    .filter((p) => p.type === 'text')
    .map((p) => (p as { type: 'text'; text: string }).text)
    .join('\n');
  return { ...msg, content: text };
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
    log.warn('[orchestrator] no active tenant for destination', {
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
    input.customerName,
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

  // 2b. Messenger/Instagram carry no name/photo in the webhook payload (unlike
  // WhatsApp's contacts[]) — best-effort backfill once per session via a Graph
  // API lookup. Awaited (not fire-and-forget) since after() may tear the function
  // context down as soon as this call returns; fetchProfile itself never throws,
  // so a failed lookup just leaves the raw id showing rather than failing the turn.
  if (!session.customerName && input.platform !== 'whatsapp' && input.platform !== 'web') {
    const profile = await metaProfile.fetchProfile(input.externalUserId, tenant);
    if (profile) await sessions.setCustomerIdentity(session.id, profile);
  }

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

    // 4b. During-handoff escalation backstop (docs/18 §4 finding #10) — the LLM is
    // skipped above, so it can't re-flag a customer getting angrier after a human
    // took over. A keyword-only heuristic bumps the sticky alert_signal instead, no
    // model call. `setAlertSignal` already notifies only on a real transition, so a
    // customer sending several escalating messages in a row still notifies once.
    if (userText && detectEscalationKeywords(userText)) {
      const changed = await sessions.setAlertSignal(session.id, 'frustrated');
      if (changed) {
        await notifyBoth({
          tenantId: tenant.id,
          type: 'alert_signal',
          entityType: 'session',
          entityId: session.id,
          agency: {
            title: 'Still escalating',
            body: `${tenant.businessName} — customer still escalating on a handed-over chat`,
            link: `/admin/chat?session=${session.id}`,
          },
          tenant: {
            title: 'Still escalating',
            body: 'Customer still escalating on a handed-over chat',
            link: `/dashboard/chat?session=${session.id}`,
          },
        });
      }
    }

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
  // 6. Short-term memory (chronological, token-budgeted). `truncated`/`oldestKeptAt`
  // feed the rolling-summary refresh at step 13 (docs/18 §2, Stage U-mem).
  const {
    messages: history,
    truncated: windowTruncated,
    oldestKeptAt: windowOldestAt,
  } = await messages.loadWindow(session.id, MEMORY_TOKEN_BUDGET);

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

  // 6c. Cross-turn image memory: images ride only the turn they arrive on (the cache
  // contract) and the history window is text-only, so a later "the picture I sent you" is
  // invisible to the model. When THIS turn has no new image BUT the customer's words refer
  // to one, re-attach the single most recent image shared within the window so the
  // reference resolves. Gated on an explicit image reference so a plain "hello" doesn't
  // pull in a stale image (and, on a text-only model, waste a doomed vision call).
  // Best-effort: re-attaching a past image must never block the reply.
  let effectiveImageUrls = imageUrls;
  if ((!imageUrls || imageUrls.length === 0) && userText && IMAGE_REFERENCE_RE.test(userText)) {
    try {
      const recent = await mediaIntake.getRecentImageUrl(session, tenant, RECENT_IMAGE_REATTACH_WINDOW_MINUTES);
      if (recent) effectiveImageUrls = [recent];
    } catch (err) {
      log.warn('[orchestrator] recent-image re-attach failed', {
        tenantId: tenant.id,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  // 7. Cache-ordered prompt: [static prefix] ++ history ++ new user msg (+ images, §4.2).
  const built = promptBuilder.build({ tenant, history, userText, imageUrls: effectiveImageUrls, pendingReview });

  // 7b. Dynamic "open now" line — server-computed, injected AFTER the cache prefix so it
  // never touches the byte-identical static block (docs/12 §4.3). Only emitted when the
  // tenant has configured hours.
  const openNow = computeOpenNow(tenant.businessHours, tenant.timezone);
  if (openNow) {
    // A holiday closure (docs/19 O5) rides in business_hours; when active, tell the
    // model why it's closed and the owner's away message so it can reassure customers.
    const closureNote = openNow.closureMessage
      ? ` It is closed for a holiday/scheduled break — tell the customer: "${openNow.closureMessage}"`
      : '';
    built.messages.splice(built.cachePrefixLength, 0, {
      role: 'system',
      content: `[context] Current local time for this business: ${openNow.localTimeLabel} (${tenant.timezone}). The business is currently ${openNow.isOpen ? 'OPEN' : 'CLOSED'}.${closureNote}`,
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

  // 7d. Rolling conversation summary (docs/18 §2, Stage U-mem) — injected on the
  // dynamic tail, same seam as open-now/retrieval above, NEVER in the cached static
  // prefix. Every turn that already has one gets it; REFRESHING the summary itself
  // (step 13, below) only happens on a turn whose window had to drop rows, so this
  // turn's prompt uses whatever was already stored before this turn started.
  if (session.summary) {
    built.messages.splice(built.cachePrefixLength, 0, {
      role: 'system',
      content: `[context] Summary of the earlier part of this conversation: ${session.summary}`,
    });
  }

  // 8. Resolve the LLM key (tenant BYOK from Vault, else master fallback).
  const { key, usedByok } = await getLlmKey(tenant);

  // 8b. Free-plan rolling 30-day cost ceiling (docs/18 §3, Stage U-cap, finding #7)
  // — the daily cap at step 2 only throttles NEW conversations; an existing free
  // session could otherwise run up unbounded master-key spend. Scoped to plan='free'
  // AND this turn using the master key (a BYOK free tenant spends their own key —
  // not ours to cap). Checked here, now that `usedByok` is known, before any model
  // call. Rolling window (not calendar month) so a capped tenant un-sticks on its
  // own as old spend ages out — see the else-branch below.
  if (tenant.plan === 'free' && !usedByok) {
    const cap = tenant.freeMonthlyCapUsd ?? DEFAULT_FREE_MONTHLY_CAP_USD;
    const spentUsd = await messages.getTrailing30DayMasterCostUsd(tenant.id);

    if (spentUsd >= cap) {
      // Transition-only notify (mirrors sessions.setAlertSignal) so a chatty capped-out
      // tenant doesn't spam an alert on every subsequent blocked message this month.
      const changed = await tenants.setPlanStatus(tenant.id, 'cap_reached');
      if (changed) {
        await notifyBoth({
          tenantId: tenant.id,
          type: 'upgrade_request',
          entityType: 'tenant',
          entityId: tenant.id,
          agency: {
            title: 'Free plan limit reached',
            body: `${tenant.businessName} hit its monthly free-plan spend cap ($${cap.toFixed(2)}) — upgrade or raise their cap`,
            link: `/admin/clients/${tenant.id}`,
          },
          tenant: {
            title: 'Monthly limit reached',
            body: `You've reached this month's free-plan limit ($${cap.toFixed(2)}) — upgrade to keep the AI answering.`,
            link: '/dashboard/business',
          },
        });
      }

      await messages.persist({
        sessionId: session.id,
        tenantId: tenant.id,
        role: 'assistant',
        content: FREE_PLAN_MONTHLY_CAP_REACHED_TEXT,
      });
      if (session.platform !== 'web') {
        await sendText({
          tenant,
          platform: session.platform,
          to: session.externalUserId,
          text: FREE_PLAN_MONTHLY_CAP_REACHED_TEXT,
        });
      }
      return {
        sessionId: session.id,
        replyText: session.platform === 'web' ? FREE_PLAN_MONTHLY_CAP_REACHED_TEXT : null,
        handoff: false,
      };
    } else if (tenant.planStatus === 'cap_reached') {
      // Rolling window has aged the old spend out and we're back under cap —
      // clear the flag so the tenant resumes without any manual/admin reset.
      await tenants.setPlanStatus(tenant.id, null);
    }
  }

  // 9. Bounded tool-calling loop (docs/09-ORDERS-AND-TOOLS.md §2.3). A tenant with
  // no enabled tools gets an empty list, which behaves identically to the old
  // single-call path (provider.chat with tools: undefined).
  const provider = getProvider(tenant.llmProvider);
  const tools = getEnabledTools(tenant, session);
  const conversation: LlmMessage[] = [...built.messages];
  let finalText = '';
  let finalCompletionTokens = 0;
  let strippedImages = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const chatArgs = {
      model: tenant.llmModel,
      cachePrefixLength: built.cachePrefixLength,
      tools: tools.length ? tools.map((t) => t.def) : undefined,
    };
    // Vision resilience: a model that can't accept images (e.g. a text-only OpenRouter
    // model) throws on a request carrying image parts. Rather than dropping the whole
    // turn — leaving the customer with silence — strip images from the conversation and
    // retry text-only ONCE, so a reply still goes out. Added 2026-07-22 after a vision
    // failure caused total non-response.
    let result;
    try {
      result = await provider.chat({ ...chatArgs, messages: conversation }, key);
    } catch (err) {
      if (!strippedImages && conversationHasImages(conversation)) {
        log.warn('[orchestrator] chat failed with images — retrying text-only', {
          tenantId: tenant.id,
          error: err instanceof Error ? err.message : 'unknown',
        });
        for (let i = 0; i < conversation.length; i++) conversation[i] = stripImageParts(conversation[i]);
        // The model couldn't accept the image(s) — tell it so it asks the customer to
        // describe the design in words instead of ignoring or inventing the photo. Spliced
        // on the dynamic tail (after the cache prefix), same seam as the other context lines.
        conversation.splice(built.cachePrefixLength, 0, {
          role: 'system',
          content:
            "[context] You can't view images. If the customer sent or referred to a photo, tell them " +
            'you are unable to open images and ask them to describe what they want in words.',
        });
        strippedImages = true;
        result = await provider.chat({ ...chatArgs, messages: conversation }, key);
      } else {
        throw err;
      }
    }
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
    await sessions.setHandoff(session.id, true, 'tool_exhaustion');
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
    await sessions.setHandoff(session.id, true, 'requested');
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
  const assistantMessageId = await messages.persist({
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
    try {
      await sendText({
        tenant,
        platform: session.platform,
        to: session.externalUserId,
        text: replyText,
      });
    } catch (err) {
      // docs/15-RELIABILITY-AND-DURABILITY.md §6 — a continueSession dispatch
      // (userText === null: a human resolved something hours after the
      // customer's last message) can land outside Meta's 24h window and get
      // rejected. The reply is NOT lost — it's already persisted above — but
      // it must be surfaced, not thrown into the void: mark the message
      // undelivered, flag the session, and tell the tenant so staff know it
      // needs a template or a customer re-ping. Any OTHER send failure keeps
      // its old behavior (throw — a fresh customer message's reply failing to
      // send is a real, different problem, not this specific known gap).
      if (err instanceof MetaWindowError && userText === null) {
        await messages.markDeliveryFailed(assistantMessageId);
        await sessions.setDeliveryBlockedReason(session.id, 'meta_window');
        await notify({
          scope: 'tenant',
          tenantId: tenant.id,
          type: 'handoff',
          title: "Your reply couldn't be delivered",
          body: "The 24h window closed before this reply could send — reopen it by having the customer message again, or send an approved template.",
          link: `/dashboard/chat?session=${session.id}`,
        });
      } else {
        throw err;
      }
    }
  }

  // 13. Rolling summary refresh (docs/18 §2, Stage U-mem) — best-effort, off-hot-path:
  // only runs when this turn's window had to drop rows, and never blocks or fails the
  // reply already sent above. The refreshed summary lands in time for the NEXT turn's
  // injection at step 7d, not this one — a natural, accepted one-turn lag.
  if (windowTruncated && windowOldestAt) {
    try {
      const source = await messages.loadMessagesForSummary(session.id, windowOldestAt, session.summaryThroughMessageAt);
      if (source.messages.length > 0) {
        const updatedSummary = await summarize.refreshSummary(tenant, session.summary, source.messages);
        if (updatedSummary) {
          await sessions.setSummary(session.id, updatedSummary, source.newestIncludedAt ?? windowOldestAt);
        }
      }
    } catch (err) {
      log.warn('[orchestrator] summary refresh failed', {
        tenantId: tenant.id,
        sessionId: session.id,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
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
export async function continueSession(
  sessionId: string,
  note: string,
  authoredBy: AuthoredBy = 'system',
): Promise<OrchestratorResult | null> {
  const session = await sessions.getById(sessionId);
  if (!session) return null;
  const tenant = await tenants.getById(session.tenantId);
  if (!tenant) return null;

  await messages.persist({
    sessionId: session.id,
    tenantId: tenant.id,
    role: 'system',
    content: note,
    authoredBy,
  });

  return runTurn(tenant, session, { userText: null });
}
