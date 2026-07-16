-- 0017_alert_signal.sql
-- Live Inbox alert signal. Extends the existing [HUMAN_HANDOFF] control-token
-- pattern in promptBuilder/sanitize with additional tokens the assistant may
-- append to its reply to flag frustration, a price objection, product doubt, or
-- cancellation risk — so staff can spot a heated/at-risk chat from the session
-- list without opening every conversation. Additive; null default ⇒ no
-- behaviour change until the orchestrator starts setting it.

alter table public.chat_sessions
  add column if not exists alert_signal text
    check (alert_signal is null or alert_signal in ('frustrated', 'price_objection', 'product_doubt', 'cancellation_risk'));
