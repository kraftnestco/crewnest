-- 0008_pgmq.sql   [PHASE 3 — OPTIONAL: do NOT apply for the Phase 1 MVP]
-- Durable queue upgrade. Phase 1 processes the AI turn in Next.js after();
-- enable this only when moving to a queue + consumer for retries/backpressure.
--
-- Requires Supabase Postgres 15.6.1.143+. Prefer enabling pgmq from
-- Dashboard > Integrations > Queues (it also creates the pgmq_public RPC schema
-- used by clients: supabase.schema('pgmq_public').rpc('send'|'read'|'pop'|'archive')).

do $$
begin
  create extension if not exists pgmq;
exception
  when others then
    raise notice 'pgmq not created here (enable via Supabase Dashboard > Queues): %', sqlerrm;
end
$$;

-- Durable queue for inbound messages awaiting AI processing.
do $$
begin
  perform pgmq.create('inbound_messages');
exception
  when others then
    raise notice 'pgmq.create skipped (extension not enabled yet or queue exists): %', sqlerrm;
end
$$;

-- Consumer pattern (reference):
--   1. Webhook: supabase.schema('pgmq_public').rpc('send', { queue_name:'inbound_messages', message:{...} })
--   2. Worker (Supabase Edge Function on a cron / small server):
--        read  -> supabase.schema('pgmq_public').rpc('read', { queue_name, sleep_seconds, n })
--        run   -> aiOrchestrator.handleInboundMessage(msg)   (SAME orchestrator, unchanged)
--        ack   -> supabase.schema('pgmq_public').rpc('archive', { queue_name, message_id })
-- Idempotency via public.webhook_events still applies (at-least-once delivery).
