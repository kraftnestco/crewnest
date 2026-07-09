-- 0006_rls.sql
-- Enable Row Level Security on every table and define policies.
-- Policies target the `authenticated` role. The service_role key bypasses RLS
-- by design and is confined to server-only code (see docs/02-SECURITY.md).

alter table public.profiles       enable row level security;
alter table public.tenants        enable row level security;
alter table public.user_tenants   enable row level security;
alter table public.chat_sessions  enable row level security;
alter table public.chat_messages  enable row level security;
alter table public.usage_logs     enable row level security;
alter table public.webhook_events enable row level security;

-- ---------------------------------------------------------------------------
-- profiles: self or platform admin
-- (inserts happen via the SECURITY DEFINER new-user trigger, so no insert policy)
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_platform_admin());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_platform_admin())
  with check (id = auth.uid() or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- tenants: readable by members/admin; writable by platform admin (Phase 1)
-- (Phase 2: add a tenant_admin update-own policy)
-- ---------------------------------------------------------------------------
drop policy if exists tenants_select on public.tenants;
create policy tenants_select on public.tenants
  for select to authenticated
  using (public.user_can_access_tenant(id));

drop policy if exists tenants_write on public.tenants;
create policy tenants_write on public.tenants
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- user_tenants: members see their own rows; admin manages all
-- ---------------------------------------------------------------------------
drop policy if exists user_tenants_select on public.user_tenants;
create policy user_tenants_select on public.user_tenants
  for select to authenticated
  using (public.is_platform_admin() or user_id = auth.uid());

drop policy if exists user_tenants_write on public.user_tenants;
create policy user_tenants_write on public.user_tenants
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- chat_sessions: scoped to accessible tenants (staff can toggle handoff)
-- ---------------------------------------------------------------------------
drop policy if exists chat_sessions_select on public.chat_sessions;
create policy chat_sessions_select on public.chat_sessions
  for select to authenticated
  using (public.user_can_access_tenant(tenant_id));

drop policy if exists chat_sessions_write on public.chat_sessions;
create policy chat_sessions_write on public.chat_sessions
  for all to authenticated
  using (public.user_can_access_tenant(tenant_id))
  with check (public.user_can_access_tenant(tenant_id));

-- ---------------------------------------------------------------------------
-- chat_messages: scoped; staff may insert (manual send). AI writes via service role.
-- ---------------------------------------------------------------------------
drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages
  for select to authenticated
  using (public.user_can_access_tenant(tenant_id));

drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
  for insert to authenticated
  with check (public.user_can_access_tenant(tenant_id));

-- ---------------------------------------------------------------------------
-- usage_logs: read-only for members/admin; writes are service-role only
-- ---------------------------------------------------------------------------
drop policy if exists usage_logs_select on public.usage_logs;
create policy usage_logs_select on public.usage_logs
  for select to authenticated
  using (public.user_can_access_tenant(tenant_id));

-- ---------------------------------------------------------------------------
-- webhook_events: platform admin read-only; writes are service-role only
-- ---------------------------------------------------------------------------
drop policy if exists webhook_events_select on public.webhook_events;
create policy webhook_events_select on public.webhook_events
  for select to authenticated
  using (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- Realtime: postgres_changes respects the table RLS above, so the live inbox
-- only receives rows a user is allowed to see. Add tables to the publication.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_sessions'
  ) then
    alter publication supabase_realtime add table public.chat_sessions;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;
