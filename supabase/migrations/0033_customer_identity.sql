-- 0033_customer_identity.sql
-- Real customer name + avatar on the Live Inbox instead of the raw platform id.
-- Additive only.

alter table public.chat_sessions
  add column if not exists customer_name        text,
  add column if not exists customer_avatar_url   text;
