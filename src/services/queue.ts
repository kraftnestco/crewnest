import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import type { InboundMessage } from '@/types/domain';
import { log } from '@/lib/log';

/**
 * pgmq wrapper (docs/15-RELIABILITY-AND-DURABILITY.md §2, §7 P2) — the one typed
 * home for the `pgmq_public` RPC surface (`send`/`read`/`archive`), so the
 * producer (webhook route) and the consumer (Edge Function worker) both go
 * through the same shapes instead of hand-rolling `.schema('pgmq_public').rpc(...)`
 * calls at each site. Service-role only: pgmq's queue tables are not
 * RLS-authenticated, same posture as `webhook_events`/`rate_limit_buckets`.
 *
 * Uses an UNTYPED client, deliberately not `lib/supabase/service.ts`'s
 * `Database`-typed one: `pgmq_public` is a schema Supabase's Queues integration
 * installs directly (not something this repo's hand-maintained `database.ts`
 * declares — see that file's own header on why codegen isn't available here),
 * so typing it would mean faking a schema this file doesn't otherwise track.
 * Same service-role key, same trust boundary — only the generic differs.
 */
function pgmqClient(): SupabaseClient {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const INBOUND_MESSAGES_QUEUE = 'inbound_messages';

/** The payload enqueued per inbound message — enough for the worker to call handleInboundMessage without a second lookup. */
export interface QueuedInboundMessage {
  message: InboundMessage;
  /** webhook_events.provider_msg_id — the idempotency key the worker looks up at pickup time (§3.2). Undefined only for the rare provider_msg_id-less case already tolerated at enqueue time. */
  providerMsgId?: string;
}

export interface PgmqReadMessage<T> {
  msg_id: number;
  read_ct: number;
  enqueued_at: string;
  vt: string;
  message: T;
}

/** Enqueue one message. Throws on failure — callers decide how to handle (the webhook route logs + Sentry-captures, never drops the ACK). */
export async function enqueue(payload: QueuedInboundMessage): Promise<void> {
  const svc = pgmqClient();
  const { error } = await svc.schema('pgmq_public').rpc('send', {
    queue_name: INBOUND_MESSAGES_QUEUE,
    message: payload,
  });
  if (error) throw error;
}

/** Read up to `n` messages, each hidden from other readers for `vt` seconds (pgmq's visibility timeout = the retry window on crash). */
export async function readBatch(n: number, vt: number): Promise<PgmqReadMessage<QueuedInboundMessage>[]> {
  const svc = pgmqClient();
  const { data, error } = await svc.schema('pgmq_public').rpc('read', {
    queue_name: INBOUND_MESSAGES_QUEUE,
    sleep_seconds: vt,
    n,
  });
  if (error) throw error;
  return (data ?? []) as PgmqReadMessage<QueuedInboundMessage>[];
}

/** Remove a message from the live queue after it's been durably handled (success) or parked as poison (§4). */
export async function archive(msgId: number): Promise<void> {
  const svc = pgmqClient();
  const { error } = await svc.schema('pgmq_public').rpc('archive', {
    queue_name: INBOUND_MESSAGES_QUEUE,
    message_id: msgId,
  });
  if (error) {
    // Archive failing is not fatal to the caller's own retry logic (the message
    // just gets re-read after vt expires) but must not be silent.
    log.error('[queue] archive failed', { msgId, error: error.message });
    throw error;
  }
}
