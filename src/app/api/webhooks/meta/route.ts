import { type NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { env } from '@/lib/env';
import { verifyMetaSignature } from '@/services/meta/signature';
import { parseMetaWebhook } from '@/services/meta/parse';
import { createServiceClient } from '@/lib/supabase/service';
import { enqueue } from '@/services/queue';
import type { InboundMessage } from '@/types/domain';
import { log } from '@/lib/log';

/**
 * Meta webhook (WhatsApp / Messenger / Instagram). Multi-tenant: one URL, tenant
 * resolved from the event destination. See docs/06-INTEGRATIONS.md §1.
 *
 * Stage P runtime model (docs/15-RELIABILITY-AND-DURABILITY.md §2, §7 P2):
 * verify → parse → per-message enqueue-with-dedup → 200. NO LLM work in the
 * request path — the AI turn moved entirely to the pgmq worker (Supabase Edge
 * Function `inbound-worker`), off this customer-facing request. `after()` is
 * retired for Meta inbound; it stays in use for the website widget (§6 — that
 * path is synchronous by nature, has an open HTTP response to reply on, no
 * queue needed).
 */
export const runtime = 'nodejs';
export const maxDuration = 15; // enqueue-only now — no LLM work to budget for

// --- GET: subscription verification handshake ---
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token && token === env.META_VERIFY_TOKEN) {
    return new Response(challenge ?? '', { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

// --- POST: receive events ---
export async function POST(req: NextRequest) {
  // 1. Read the RAW body — required for signature verification.
  const rawBody = await req.text();

  // 2. Verify X-Hub-Signature-256 over the raw bytes (constant-time).
  const ok = await verifyMetaSignature(
    rawBody,
    req.headers.get('x-hub-signature-256'),
    env.META_APP_SECRET,
  );
  if (!ok) return new Response('Invalid signature', { status: 401 });

  // 3. Parse + normalise to InboundMessage[].
  let inbound: InboundMessage[] = [];
  try {
    inbound = parseMetaWebhook(JSON.parse(rawBody));
  } catch {
    // Malformed JSON: ACK to stop retries; nothing to process.
    return new Response('OK', { status: 200 });
  }

  // 4. Enqueue each message — the insert into webhook_events IS the dedup gate
  // (§3.1): only a message that wins that insert gets enqueued at all, so a
  // Meta redelivery of the same provider_msg_id is skipped here, before pgmq
  // ever sees it. No LLM work happens in this request.
  for (const msg of inbound) {
    try {
      await enqueueOnce(msg);
    } catch (err) {
      // A single message failing to enqueue must not fail the whole webhook
      // (siblings in this batch should still get their chance) or cause Meta
      // to retry the messages that DID enqueue — log + Sentry-capture, then
      // keep going. Meta will redeliver this specific message on its own
      // retry schedule if our 200 below never comes; if it does come, this
      // message is simply lost — an accepted, rare failure mode (a transient
      // pgmq/DB error at enqueue time), not the silent-loss-on-every-crash
      // defect this whole doc fixes.
      log.error('[meta webhook] enqueue failed', {
        platform: msg.platform,
        error: err instanceof Error ? err.message : 'unknown',
      });
      Sentry.captureException(err, { tags: { platform: msg.platform, destinationId: msg.destinationId } });
    }
  }

  return new Response('OK', { status: 200 });
}

/**
 * Enqueue-time dedup (docs/15 §3.1): insert the provider_msg_id into
 * webhook_events FIRST; only on a successful (non-duplicate) insert do we
 * `pgmq send`. A `23505` (unique_violation) means Meta already delivered this
 * message — it's already queued or already done — so we skip enqueueing a
 * second copy. This is the gate that turns Meta's redelivery-on-slow-ACK
 * behavior into a no-op instead of a duplicate customer reply.
 *
 * `tenant_id` is deliberately left null here (docs/18 §4 finding #8) — resolving
 * it needs a tenant lookup before ACK, which the worker does anyway when it
 * calls handleInboundMessage. Don't add it here piecemeal.
 */
async function enqueueOnce(msg: InboundMessage): Promise<void> {
  const svc = createServiceClient();

  if (!msg.providerMsgId) {
    // No id to dedupe on (rare) — enqueue directly, no ledger row possible.
    await enqueue({ message: msg });
    return;
  }

  const { error } = await svc
    .from('webhook_events')
    .insert({ provider: 'meta', provider_msg_id: msg.providerMsgId });

  if (error) {
    if (error.code === '23505') return; // already seen — this IS the dedup, not a failure.
    throw error; // any other DB error is a real failure — surface it to the caller's catch.
  }

  await enqueue({ message: msg, providerMsgId: msg.providerMsgId });
}
