// inbound-worker — the pgmq consumer (docs/15-RELIABILITY-AND-DURABILITY.md §7 P3).
//
// Runs as a Supabase Edge Function (Deno), NOT Vercel — deliberately: it needs
// to run independent of the web deploy and isn't bound by Vercel's request/cron
// duration limits (§2). It cannot import aiOrchestrator.ts (Node/Next.js code)
// directly, so the actual AI turn is delegated over HTTP to a small internal
// Vercel route (src/app/api/internal/process-message/route.ts) that wraps the
// UNCHANGED handleInboundMessage — see that route's header comment for the full
// rationale. This file owns only: pgmq read, the §3.2 processing-idempotency
// state machine, and §4 poison-message handling. It is invoked on a schedule by
// pg_cron + pg_net (see the SQL block at the bottom of this file's sibling
// migration note in handoff.md — run manually, like every other migration).
//
// Mirrors these constants from src/lib/constants.ts (Deno can't import that
// Node file — keep both in sync if either changes):
const MAX_MESSAGE_ATTEMPTS = 5; // docs/15 §4
// Raised 30 → 120 for message batching (docs/23 §7): a batched turn runs for the
// grace window + several provider calls + tool execution, and a turn outliving
// this leaves its pgmq row eligible for redelivery while STILL processing.
// Must stay above TURN_LEASE_TTL_SECONDS (90) in src/lib/constants.ts.
const VISIBILITY_TIMEOUT_SECONDS = 120; // docs/15 §4, docs/23 §7
const BATCH_SIZE = 10; // docs/15 §7 P3 ("n=10")
const QUEUE_NAME = 'inbound_messages';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_URL = Deno.env.get('APP_URL')!; // e.g. https://crewnest-rouge.vercel.app — the Vercel deploy, not Supabase
const CRON_SECRET = Deno.env.get('CRON_SECRET')!; // same secret api/internal/process-message checks
const WORKER_SECRET = Deno.env.get('INBOUND_WORKER_SECRET')!; // authenticates the caller of THIS function

interface QueuedInboundMessage {
  message: Record<string, unknown>;
  providerMsgId?: string;
}

interface PgmqReadRow {
  msg_id: number;
  read_ct: number;
  enqueued_at: string;
  vt: string;
  message: QueuedInboundMessage;
}

function restHeaders(): HeadersInit {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

/** Read up to BATCH_SIZE messages via the pgmq_public RPC surface (same schema services/queue.ts uses from the Node side). */
async function readBatch(): Promise<PgmqReadRow[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/read`, {
    method: 'POST',
    headers: { ...restHeaders(), 'Content-Profile': 'pgmq_public' },
    body: JSON.stringify({ queue_name: QUEUE_NAME, sleep_seconds: VISIBILITY_TIMEOUT_SECONDS, n: BATCH_SIZE }),
  });
  if (!res.ok) throw new Error(`pgmq read failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as PgmqReadRow[];
}

async function archiveMessage(msgId: number): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/archive`, {
    method: 'POST',
    headers: { ...restHeaders(), 'Content-Profile': 'pgmq_public' },
    body: JSON.stringify({ queue_name: QUEUE_NAME, message_id: msgId }),
  });
  if (!res.ok) throw new Error(`pgmq archive failed (${res.status}): ${await res.text()}`);
}

interface WebhookEventRow {
  id: string;
  status: string;
  read_ct: number;
  tenant_id: string | null;
}

/** Look up the webhook_events row by provider_msg_id — the idempotency ledger (docs/15 §3.2 step 1). */
async function getWebhookEvent(providerMsgId: string): Promise<WebhookEventRow | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/webhook_events?provider=eq.meta&provider_msg_id=eq.${encodeURIComponent(providerMsgId)}&select=id,status,read_ct,tenant_id`,
    { headers: restHeaders() },
  );
  if (!res.ok) throw new Error(`webhook_events lookup failed (${res.status}): ${await res.text()}`);
  const rows = (await res.json()) as WebhookEventRow[];
  return rows[0] ?? null;
}

async function updateWebhookEvent(id: string, patch: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/webhook_events?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...restHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`webhook_events update failed (${res.status}): ${await res.text()}`);
}

/** §4 — agency-only system_alert when a message is parked as poison. Raw insert (this runtime can't import services/notifications.ts). */
async function notifyPoison(tenantId: string | null, providerMsgId: string, lastError: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
    method: 'POST',
    headers: { ...restHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({
      scope: 'agency',
      tenant_id: tenantId,
      type: 'system_alert',
      title: 'A message failed repeatedly and was abandoned',
      body: `provider_msg_id ${providerMsgId} failed ${MAX_MESSAGE_ATTEMPTS} times: ${lastError.slice(0, 300)}`,
      link: '/admin/health',
    }),
  });
  if (!res.ok) {
    // Best-effort — a failed notification must not stop the worker from
    // continuing to park the poison message (that part already succeeded).
    console.error('[inbound-worker] poison notify failed', await res.text());
  }
}

/** POST the message to the internal Vercel bridge route, which calls the unchanged handleInboundMessage. */
async function processViaBridge(message: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${APP_URL}/api/internal/process-message`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CRON_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error(`process-message bridge failed (${res.status}): ${await res.text()}`);
}

/** The §3.2 loop, one pgmq row at a time. */
async function handleOne(row: PgmqReadRow): Promise<void> {
  const inboundMessage = row.message.message;
  const providerMsgId = row.message.providerMsgId;

  if (!providerMsgId) {
    // No idempotency ledger row possible (the rare provider_msg_id-less case,
    // already tolerated at enqueue time) — just process once and archive.
    await processViaBridge(inboundMessage);
    await archiveMessage(row.msg_id);
    return;
  }

  const event = await getWebhookEvent(providerMsgId);
  if (!event) {
    // Should not happen (the webhook route inserts this row before enqueueing)
    // but fail safe: archive rather than loop forever on an orphaned message.
    console.error('[inbound-worker] no webhook_events row for', providerMsgId, '— archiving without processing');
    await archiveMessage(row.msg_id);
    return;
  }

  // Step 2 — already done (crash after success, before archive). Archive only.
  if (event.status === 'done') {
    await archiveMessage(row.msg_id);
    return;
  }
  // Step 3 — already parked as poison. Archive only.
  if (event.status === 'dead') {
    await archiveMessage(row.msg_id);
    return;
  }

  // Step 4 — mark processing, bump read_ct, then run the turn.
  const nextReadCt = row.read_ct; // pgmq's own read_ct on this row IS the attempt count.
  await updateWebhookEvent(event.id, { status: 'processing', read_ct: nextReadCt });

  try {
    await processViaBridge(inboundMessage);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    // §4 — poison threshold reached: park it, notify, archive. Do NOT re-throw
    // (a poison message must stop retrying, not keep re-surfacing).
    if (nextReadCt >= MAX_MESSAGE_ATTEMPTS) {
      await updateWebhookEvent(event.id, { status: 'dead', last_error: errMsg });
      await notifyPoison(event.tenant_id, providerMsgId, errMsg);
      await archiveMessage(row.msg_id);
      return;
    }

    // Step 6 — record the error, do NOT archive. pgmq's visibility timeout
    // re-surfaces this message on the next read once vt expires — that's the retry.
    await updateWebhookEvent(event.id, { status: 'queued', last_error: errMsg });
    return;
  }

  // Step 5 — success: done, then archive.
  await updateWebhookEvent(event.id, { status: 'done', processed_at: new Date().toISOString() });
  await archiveMessage(row.msg_id);
}

Deno.serve(async (req) => {
  const auth = req.headers.get('authorization');
  if (!WORKER_SECRET || auth !== `Bearer ${WORKER_SECRET}`) {
    return new Response('Forbidden', { status: 403 });
  }

  let claimed = 0;
  let failed = 0;

  try {
    const rows = await readBatch();
    claimed = rows.length;
    for (const row of rows) {
      try {
        await handleOne(row);
      } catch (err) {
        failed++;
        console.error('[inbound-worker] row failed', row.msg_id, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error('[inbound-worker] readBatch failed', err instanceof Error ? err.message : err);
    return Response.json({ ok: false, error: 'read failed' }, { status: 500 });
  }

  return Response.json({ ok: true, claimed, failed });
});
