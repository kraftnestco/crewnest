-- 0030_analytics.sql
-- Stage Q (docs/16-ANALYTICS-AND-PROOF.md §5) — authorship marker, handoff cause,
-- CSAT-prompt flag (designed but flagged off), and the covering indexes analytics
-- range queries need. Additive only; existing rows default correctly.

alter table public.chat_messages
  add column if not exists authored_by text not null default 'ai';

alter table public.chat_messages drop constraint if exists chat_messages_authored_by_check;
alter table public.chat_messages add constraint chat_messages_authored_by_check
  check (authored_by in ('ai', 'human', 'system'));

alter table public.chat_sessions
  add column if not exists handoff_cause text;

alter table public.chat_sessions drop constraint if exists chat_sessions_handoff_cause_check;
alter table public.chat_sessions add constraint chat_sessions_handoff_cause_check
  check (handoff_cause is null or handoff_cause in ('requested', 'alert', 'tool_exhaustion', 'media_review'));

alter table public.tenants
  add column if not exists csat_prompt_enabled boolean not null default false;

-- Covering indexes for range-scoped aggregate queries (services/analytics.ts).
-- usage_logs (tenant_id, created_at desc) and orders (tenant_id, created_at desc)
-- already exist (0004, 0009); chat_sessions/chat_messages need the range-filter shape below.
create index if not exists chat_sessions_tenant_created_idx
  on public.chat_sessions (tenant_id, created_at);
create index if not exists chat_messages_tenant_role_created_idx
  on public.chat_messages (tenant_id, role, created_at);
