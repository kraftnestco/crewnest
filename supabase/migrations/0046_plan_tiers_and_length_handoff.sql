-- 0046_plan_tiers_and_length_handoff.sql
-- New plan tier ('growth', $49) + a new handoff cause for the per-plan
-- conversation-length limit. Additive; no data migration.
--
-- PLAN CHANGES (lib/entitlements.ts is the source of truth for the limits):
--   free    $0   — 5 conversations/day, 20 messages/conversation, 1 channel
--   starter $39  — 5 conversations/day, unlimited length, all channels
--   growth  $49  — 20 conversations/day, unlimited length, all channels, Copilot
--   pro     $79  — unlimited conversations, all channels, Copilot
--
-- Existing 'starter' tenants keep their plan id and simply move to the new $39
-- price at renewal; nothing needs backfilling. There is deliberately NO check
-- constraint added to tenants.plan: it has been an app-validated allow-list
-- since 0025 (like business_type/media_handling), and adding a DB constraint
-- here would be a behaviour change unrelated to this migration's purpose.

-- The AI now hands a conversation to a human when it exceeds the plan's
-- per-conversation message budget. 0030 constrained handoff_cause to a closed
-- set, so the new value must be admitted here or every such handoff would fail
-- the write. Re-stated in full (not appended) because Postgres has no
-- "add value to check constraint" — the constraint is dropped and recreated.
alter table public.chat_sessions drop constraint if exists chat_sessions_handoff_cause_check;
alter table public.chat_sessions add constraint chat_sessions_handoff_cause_check
  check (
    handoff_cause is null
    or handoff_cause in ('requested', 'alert', 'tool_exhaustion', 'media_review', 'length_limit')
  );

-- Counting a session's customer messages is now on the hot path for every
-- inbound turn on a length-limited plan (services/messages.ts countUserMessages).
-- chat_messages already has a session_id index; this partial composite makes the
-- role='user' count an index-only scan rather than a filter over all roles.
create index if not exists chat_messages_session_user_role_idx
  on public.chat_messages (session_id)
  where role = 'user';
