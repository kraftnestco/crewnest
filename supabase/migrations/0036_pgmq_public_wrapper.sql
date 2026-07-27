-- 0036_pgmq_public_wrapper.sql
-- docs/15-RELIABILITY-AND-DURABILITY.md §2, §7 P1/P2/P3.
--
-- Supabase's "Expose Queues via PostgREST" dashboard toggle (which normally
-- auto-creates a pgmq_public wrapper schema) is not available on this
-- project's dashboard (no dedicated Queues page under Database — confirmed
-- 2026-07-26). This migration creates that wrapper ourselves, following the
-- documented community workaround for exactly this situation. Thin SQL
-- wrappers around the real pgmq.* functions (confirmed signatures, this
-- project's installed pgmq 1.5.1, verified via direct introspection):
--   pgmq.send(queue_name text, msg jsonb) returns SETOF bigint
--   pgmq.read(queue_name text, vt integer, qty integer, conditional jsonb DEFAULT '{}') returns SETOF pgmq.message_record
--   pgmq.archive(queue_name text, msg_id bigint) returns boolean
-- pgmq.message_record columns (verified empirically via a real send+read):
--   msg_id bigint, read_ct integer, enqueued_at timestamptz, vt timestamptz,
--   message jsonb, headers jsonb
--
-- Once created, add `pgmq_public` to Project Settings → Data API → Exposed
-- schemas (it should now appear as a real option, since the schema exists).
-- Service-role only — same posture as every other queue-adjacent table.

create schema if not exists pgmq_public;

grant usage on schema pgmq_public to service_role;

create or replace function pgmq_public.send(
  queue_name text,
  message jsonb
) returns bigint
language sql
security definer
set search_path = pgmq, public
as $$
  select * from pgmq.send(queue_name, message) limit 1;
$$;

create or replace function pgmq_public.read(
  queue_name text,
  sleep_seconds integer,
  n integer
) returns setof pgmq.message_record
language sql
security definer
set search_path = pgmq, public
as $$
  select * from pgmq.read(queue_name, sleep_seconds, n);
$$;

create or replace function pgmq_public.archive(
  queue_name text,
  message_id bigint
) returns boolean
language sql
security definer
set search_path = pgmq, public
as $$
  select pgmq.archive(queue_name, message_id);
$$;

revoke all on function pgmq_public.send(text, jsonb) from public, anon, authenticated;
revoke all on function pgmq_public.read(text, integer, integer) from public, anon, authenticated;
revoke all on function pgmq_public.archive(text, bigint) from public, anon, authenticated;

grant execute on function pgmq_public.send(text, jsonb) to service_role;
grant execute on function pgmq_public.read(text, integer, integer) to service_role;
grant execute on function pgmq_public.archive(text, bigint) to service_role;
