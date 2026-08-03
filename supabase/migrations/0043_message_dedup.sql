-- 0043_message_dedup.sql
-- Stop a retried AI turn from persisting the SAME customer message twice.
--
-- Observed live 2026-08-03: a customer sent one Instagram message and the Live
-- Inbox showed it twice. webhook_events had a single row (so webhook dedup
-- worked correctly) with read_ct=2 and
-- last_error='process-message bridge failed (504)'.
--
-- The sequence: the bridge route exceeded Vercel's function limit, the worker
-- correctly left the pgmq message unarchived, pgmq redelivered it, and the
-- second run of handleInboundMessage persisted the user's message again —
-- because that insert is unconditional and nothing checked whether this
-- provider_msg_id had already been stored.
--
-- Retry itself is right and must stay: it's what stops a crash from losing a
-- message. What was missing is making the retry IDEMPOTENT at the point of
-- insert, the same posture as orders' dedupe_fingerprint and appointments'
-- partial unique index.

-- Partial: only rows that actually carry a provider id participate. Web-widget
-- messages and assistant/system rows have provider_msg_id null and must stay
-- freely insertable — a null would otherwise collide on a plain unique index.
create unique index if not exists chat_messages_provider_msg_id_idx
  on public.chat_messages (provider_msg_id)
  where provider_msg_id is not null;
