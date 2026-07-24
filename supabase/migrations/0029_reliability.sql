-- 0029_reliability.sql
-- Stage P (docs/15-RELIABILITY-AND-DURABILITY.md §3.2, §4, §5, §6, §7). Additive only.
--
-- Note: 'system_alert' was already pulled forward into notifications_type_check
-- by migration 0031 (see its trailing comment) so poison-message alerts (§4)
-- would have a valid type even before this migration landed. Redefining the
-- same constraint here is idempotent and keeps this file correct standing on
-- its own, whichever order it's actually run relative to 0031.

-- ---------------------------------------------------------------------------
-- §3.2 — processing-time idempotency. A pgmq message re-surfaced after a
-- worker crash must not double-fire the outbound reply, and a message parked
-- as poison (§4) must not be reprocessed.
-- ---------------------------------------------------------------------------
alter table public.webhook_events
  add column if not exists status       text not null default 'queued',
  add column if not exists processed_at timestamptz,
  add column if not exists read_ct      integer not null default 0,
  add column if not exists last_error   text;

alter table public.webhook_events drop constraint if exists webhook_events_status_check;
alter table public.webhook_events add constraint webhook_events_status_check
  check (status in ('queued', 'processing', 'done', 'dead'));

-- ---------------------------------------------------------------------------
-- §5 — durable, cross-instance rate limiting for the website widget (the
-- only unauthenticated caller). Service-role only: RLS is enabled with
-- deliberately zero policies, so authenticated/anon get default-deny; only
-- the service client (used by checkRateLimit) can read or write. bucket_key
-- may embed a caller IP, so there's no legitimate authenticated-read case.
-- Old windows are swept by the retention job (docs/17 §4).
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limit_buckets (
  bucket_key    text        not null,
  window_start  bigint      not null,   -- epoch ms of the window, floor(now/windowMs)*windowMs
  count         integer     not null default 0,
  primary key (bucket_key, window_start)
);

alter table public.rate_limit_buckets enable row level security;
-- No policies: service-role only (bypasses RLS), same reasoning as usage_logs/webhook_events writes.

-- ---------------------------------------------------------------------------
-- §6 — a continueSession reply attempted outside Meta's 24h window is
-- surfaced to the tenant instead of thrown into the void. Null = no
-- delivery-window problem (safe default).
-- ---------------------------------------------------------------------------
alter table public.chat_sessions
  add column if not exists delivery_blocked_reason text;

-- ---------------------------------------------------------------------------
-- §4 — poison-message alerts are an agency-only 'system_alert' notification.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'new_order','handoff','alert_signal','channel_request','payment_proof',
    'upgrade_request','review','order_updated','media_review','system_alert'
  ));
