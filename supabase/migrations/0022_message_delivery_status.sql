-- 0022_message_delivery_status.sql
-- Tracks whether an assistant chat_messages row that required an outbound
-- Meta send (order confirmation, manual agent reply) actually reached the
-- customer. Previously the row was inserted before the send attempt and never
-- updated on failure, so a failed delivery looked identical to a successful
-- one forever. Additive; null/false default ⇒ no behaviour change for
-- existing rows or web-platform messages (which have no delivery concept).

alter table public.chat_messages
  add column if not exists delivery_failed boolean not null default false;
