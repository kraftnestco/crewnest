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
import * as promptBuilder from './ai/promptBuilder';
import { getProvider } from './ai/provider';
import { estimateCostUsd } from './ai/pricing';
import { getLlmKey } from '@/lib/secrets';
import { sendText } from './meta/send';
import {
  sanitizeInbound,
  stripHandoffToken,
  assistantRequestedHandoff,
} from './security/sanitize';
import { MEMORY_TOKEN_BUDGET } from '@/lib/constants';
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
  const userText = sanitizeInbound(input.text);

  // 4. Handoff gate — hard stop. Persist so a human sees it in the inbox; no LLM.
  if (session.isHumanHandoff) {
    await messages.persist({
      sessionId: session.id,
      tenantId: tenant.id,
      role: 'user',
      content: userText,
      providerMsgId: input.providerMsgId,
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
  });

  // 6. Short-term memory (chronological, token-budgeted).
  const history = await messages.loadWindow(session.id, MEMORY_TOKEN_BUDGET);

  // 7. Cache-ordered prompt: [static prefix] ++ history ++ new user msg.
  const built = promptBuilder.build({ tenant, history, userText });

  // 8. Resolve the LLM key (tenant BYOK from Vault, else master fallback).
  const { key, usedByok } = await getLlmKey(tenant);

  // 9. Call the provider via the abstraction.
  const provider = getProvider(tenant.llmProvider);
  const result = await provider.chat(
    {
      model: tenant.llmModel,
      messages: built.messages,
      cachePrefixLength: built.cachePrefixLength,
    },
    key,
  );
  // NOTE: `key` is intentionally not referenced again and never logged.

  // 10. Handoff detection — honoured ONLY from assistant output.
  const handoff = assistantRequestedHandoff(result.text);
  const replyText = stripHandoffToken(result.text);

  // 11. Metering (always record, even on handoff).
  await messages.logUsage({
    tenantId: tenant.id,
    sessionId: session.id,
    provider: provider.id,
    model: tenant.llmModel,
    usage: result.usage,
    usedByok,
    costUsd: estimateCostUsd(result.usage, tenant.llmModel),
  });

  if (handoff) {
    await sessions.setHandoff(session.id, true);
    // Do not auto-reply; a human takes over. Inbox turns red via realtime.
    return { sessionId: session.id, replyText: null, handoff: true };
  }

  // 12. Persist the assistant reply.
  await messages.persist({
    sessionId: session.id,
    tenantId: tenant.id,
    role: 'assistant',
    content: replyText,
    tokenCount: result.usage.completionTokens,
  });

  // 13. Dispatch. Web widget returns the text in its HTTP response instead of sending.
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
