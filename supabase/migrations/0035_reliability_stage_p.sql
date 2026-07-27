-- 0035_reliability_stage_p.sql
-- docs/15-RELIABILITY-AND-DURABILITY.md §5, Stage P4 (durable rate limiting).
-- Additive only. `0029_reliability.sql` already created `rate_limit_buckets`
-- (and the webhook_events/notifications/chat_sessions changes for §3.2/§4/§6);
-- this migration only adds the atomic increment function `checkRateLimitDb`
-- needs — a plain PostgREST upsert can express "replace on conflict" but not
-- "increment on conflict," so the atomic increment has to live in SQL.

create or replace function public.increment_rate_limit_bucket(
  p_bucket_key text,
  p_window_start bigint
) returns integer
language sql
security definer
set search_path = public
as $$
  insert into public.rate_limit_buckets (bucket_key, window_start, count)
  values (p_bucket_key, p_window_start, 1)
  on conflict (bucket_key, window_start)
  do update set count = rate_limit_buckets.count + 1
  returning count;
$$;

-- Service-role only, mirroring the table's own RLS posture (0029: RLS enabled,
-- zero policies — only the service client bypasses RLS to call this).
revoke all on function public.increment_rate_limit_bucket(text, bigint) from public, anon, authenticated;
