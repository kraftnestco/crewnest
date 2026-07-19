-- 0023_notifications.sql — Track 1 (docs/14). Live notification feed for both shells.

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  -- Audience is MUTUALLY EXCLUSIVE by design (see RLS below): a row is for the agency
  -- OR for a tenant's own members, never "both" — shared events emit two rows with
  -- audience-appropriate copy + link.
  scope        text not null check (scope in ('agency','tenant')),
  tenant_id    uuid references public.tenants(id) on delete cascade,
  type         text not null check (type in (
                 'new_order','handoff','alert_signal','channel_request','payment_proof'
               )),
  title        text not null,
  body         text,
  entity_type  text,
  entity_id    uuid,
  link         text not null,
  is_read      boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists notifications_scope_read_idx
  on public.notifications (scope, is_read, created_at desc);
create index if not exists notifications_tenant_idx
  on public.notifications (tenant_id, is_read, created_at desc);

alter table public.notifications enable row level security;

-- Agency rows: platform admins only.
drop policy if exists notifications_select_agency on public.notifications;
create policy notifications_select_agency on public.notifications
  for select to authenticated
  using (scope = 'agency' and public.is_platform_admin());

-- Tenant rows: DIRECT members of that tenant only. Deliberately NOT via
-- public.user_can_access_tenant(), because that helper returns true for a
-- platform_admin too — which would leak every client's tenant feed into the
-- agency bell. Membership is checked directly so the two audiences stay disjoint.
drop policy if exists notifications_select_tenant on public.notifications;
create policy notifications_select_tenant on public.notifications
  for select to authenticated
  using (
    scope = 'tenant'
    and exists (
      select 1 from public.user_tenants ut
      where ut.user_id = auth.uid() and ut.tenant_id = notifications.tenant_id
    )
  );

-- No INSERT/UPDATE/DELETE policy: writes are service-role only (matches
-- usage_logs/webhook_events/orders — see docs/14 §2.2).

alter table public.profiles
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

-- Realtime: postgres_changes respects the RLS above, so the bell only receives
-- rows a user is allowed to see.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
