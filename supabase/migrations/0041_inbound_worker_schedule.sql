-- 0041_inbound_worker_schedule.sql
-- docs/15-RELIABILITY-AND-DURABILITY.md §7 P3's own code comment
-- (supabase/functions/inbound-worker/index.ts) has always claimed the worker
-- "is invoked on a schedule by pg_cron + pg_net" — but no migration ever
-- created that schedule. Confirmed live 2026-08-03: a real Instagram message
-- sat in the pgmq queue, fully enqueued and correctly deduped, until the
-- worker was triggered BY HAND with a curl request. Every customer message
-- would otherwise wait forever. This migration is the schedule that was
-- always meant to exist.
--
-- BEFORE RUNNING: this project's pg_net version determines net.http_post's
-- exact parameter shape (Supabase has changed it across versions — body as
-- jsonb vs text, params vs body, etc). Check Database → Extensions → pg_net
-- for the installed version, then check its signature with:
--   select pg_get_function_arguments(oid) from pg_proc where proname = 'http_post';
-- Adjust the call below if it doesn't match before running the rest of this file.
--
-- The exact SQL run against the live project (real project ref + secret
-- filled in, never committed here) is tracked in this session's chat only —
-- confirm cron.job_run_details shows status='succeeded' before treating this
-- as done; update handoff.md once confirmed.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- pg_cron runs as the postgres user, which can't read Vault directly the way
-- application code does (services/*.ts always go through the service-role
-- client) — the secret has to be embedded in the scheduled command itself,
-- same trust boundary as the Vercel/Supabase env vars it's compared against.
-- REPLACE THE TWO PLACEHOLDERS BELOW WITH REAL VALUES (do not commit real
-- values back into this file — it lives in git; edit only in the SQL editor
-- before running):
--   <PROJECT_REF>          e.g. juknslsaalykuzifieur
--   <INBOUND_WORKER_SECRET> the SAME value set via `npx supabase secrets set INBOUND_WORKER_SECRET=...`

select cron.schedule(
  'inbound-worker-tick',
  '* * * * *', -- every minute (docs/15 §7 P3: "on a cron (every minute)")
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/inbound-worker',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <INBOUND_WORKER_SECRET>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To check it's actually firing: select * from cron.job_run_details order by
-- start_time desc limit 5; — status should be 'succeeded', not 'failed'.
-- To stop it: select cron.unschedule('inbound-worker-tick');
