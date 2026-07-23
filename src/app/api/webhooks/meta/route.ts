import { after, type NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { env } from '@/lib/env';
import { verifyMetaSignature } from '@/services/meta/signature';
import { parseMetaWebhook } from '@/services/meta/parse';
import { handleInboundMessage } from '@/services/aiOrchestrator';
import { createServiceClient } from '@/lib/supabase/service';
import type { InboundMessage } from '@/types/domain';
import { log } from '@/lib/log';

/**
 * Meta webhook (WhatsApp / Messenger / Instagram). Multi-tenant: one URL, tenant
 * resolved from the event destination. See docs/06-INTEGRATIONS.md §1.
 *
 * Phase 1 runtime model (docs/01-ARCHITECTURE.md §2): Node runtime, ACK < 1s,
 * then process the AI turn in after(). NOT Edge, NOT synchronous LLM.
 */
export const runtime = 'nodejs';
export const maxDuration = 60; // allow the after() AI turn to complete

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

  // 4. Idempotency: keep only events we have not seen before.
  const fresh = await dedupe(inbound);

  // 5. ACK immediately, then process the AI turn after the response is sent.
  after(async () => {
    for (const msg of fresh) {
      try {
        await handleInboundMessage(msg);
      } catch (err) {
        // Log metadata only — never message bodies or secrets.
        log.error('[meta webhook] processing failed', {
          platform: msg.platform,
          error: err instanceof Error ? err.message : 'unknown',
        });
        Sentry.captureException(err, { tags: { platform: msg.platform, destinationId: msg.destinationId } });
      }
    }
  });

  return new Response('OK', { status: 200 });
}

/**
 * Insert each provider_msg_id into webhook_events; return only the newly-seen ones.
 *
 * `tenant_id` is deliberately left null here (docs/18 §4 finding #8) — resolving it
 * needs a tenant lookup before ACK, which folds into doc-15's full webhook rewrite
 * (Stage P2), not this pre-ACK dedupe path. Don't add it here piecemeal.
 */
async function dedupe(messages: InboundMessage[]): Promise<InboundMessage[]> {
  const svc = createServiceClient();
  const fresh: InboundMessage[] = [];
  for (const msg of messages) {
    if (!msg.providerMsgId) {
      fresh.push(msg); // no id to dedupe on; process (rare)
      continue;
    }
    const { error } = await svc
      .from('webhook_events')
      .insert({ provider: 'meta', provider_msg_id: msg.providerMsgId });
    if (!error) {
      fresh.push(msg);
    } else if (error.code !== '23505') {
      // Not a duplicate-key error → log and still process to avoid dropping messages.
      log.error('[meta webhook] dedupe insert error', { code: error.code });
      fresh.push(msg);
    }
    // 23505 (unique_violation) => already handled; skip.
  }
  return fresh;
}
