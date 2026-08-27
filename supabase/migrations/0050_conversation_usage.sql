-- 0050_conversation_usage.sql
-- Monthly billable-conversation metering with a 24h inactivity window.
--
-- A row = one billable conversation for a tenant. Counted per calendar month
-- (UTC). Re-opened after 24h of silence inserts another row for the same session.
-- Existing daily session-create caps are retired in app code; this table is the
-- new source of truth for conversation quotas.

create table if not exists public.conversation_usage (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  session_id uuid not null references public.chat_sessions (id) on delete cascade,
  billed_at timestamptz not null default now()
);

create index if not exists conversation_usage_tenant_month_idx
  on public.conversation_usage (tenant_id, billed_at desc);

create index if not exists conversation_usage_session_idx
  on public.conversation_usage (session_id, billed_at desc);

alter table public.conversation_usage enable row level security;

-- Read-only for members/admin (mirrors usage_logs); writes are service-role only.
drop policy if exists conversation_usage_select on public.conversation_usage;
create policy conversation_usage_select on public.conversation_usage
  for select to authenticated
  using (public.user_can_access_tenant(tenant_id));
