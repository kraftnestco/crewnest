import { type NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { env } from '@/lib/env';
import { handleInboundMessage } from '@/services/aiOrchestrator';
import type { InboundMessage } from '@/types/domain';
import { log } from '@/lib/log';

/**
 * Internal bridge for the pgmq worker (docs/15-RELIABILITY-AND-DURABILITY.md §7
 * P3). The worker itself is a Supabase Edge Function (Deno) — it cannot import
 * `aiOrchestrator.ts` (Node/Next.js code, `server-only` deps) directly, so this
 * route is the seam: the Edge Function does the pgmq read + idempotency/poison
 * bookkeeping (docs/15 §3.2, §4), then POSTs the message here for the ACTUAL
 * turn. `handleInboundMessage` itself is unchanged — this route is pure
 * plumbing, mirroring the doc's own "aiOrchestrator is unchanged" acceptance
 * criterion (§8).
 *
 * Auth: same CRON_SECRET bearer-token pattern as api/cron/maintenance — this
 * is a server-to-server call from Supabase's infrastructure, not a browser or
 * a public webhook, so a shared secret (already provisioned for cron) is the
 * right trust boundary rather than inventing a second secret.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!env.CRON_SECRET) {
    log.error('[internal/process-message] rejected — CRON_SECRET not provisioned');
    return new Response('Forbidden', { status: 403 });
  }

  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    return new Response('Forbidden', { status: 403 });
  }

  let message: InboundMessage;
  try {
    const body = await req.json();
    message = body.message as InboundMessage;
    if (!message || typeof message !== 'object') throw new Error('missing message');
  } catch {
    return Response.json({ ok: false, error: 'bad request' }, { status: 400 });
  }

  try {
    const result = await handleInboundMessage(message);
    return Response.json({ ok: true, result });
  } catch (err) {
    // Metadata only — never message bodies or secrets (same rule as the
    // Meta webhook route this replaces the inline after() call from).
    log.error('[internal/process-message] processing failed', {
      platform: message.platform,
      error: err instanceof Error ? err.message : 'unknown',
    });
    Sentry.captureException(err, { tags: { platform: message.platform, destinationId: message.destinationId } });
    // Non-2xx tells the Edge Function this attempt failed — it leaves the pgmq
    // message unarchived so the visibility timeout re-surfaces it (docs/15 §3.2
    // step 6, the retry mechanism). A thrown error here must never look like success.
    return Response.json({ ok: false, error: 'processing failed' }, { status: 500 });
  }
}
