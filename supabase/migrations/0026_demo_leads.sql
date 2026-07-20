-- 0026_demo_leads.sql — public demo funnel lead capture ("try it for your
-- business" plan, Phase B's deferred [OPUS] item). RLS mirrors
-- webhook_events (0006_rls.sql): platform-admin read-only, no INSERT/UPDATE/
-- DELETE policy since writes are service-role only (the demo route has no
-- authenticated session at all).

create table if not exists public.demo_leads (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,
  business_name    text not null,
  business_type    text not null check (business_type in ('product','service')),
  intake_snapshot  jsonb not null,
  created_at       timestamptz not null default now()
);

create index if not exists demo_leads_created_at_idx
  on public.demo_leads (created_at desc);

alter table public.demo_leads enable row level security;

drop policy if exists demo_leads_select on public.demo_leads;
create policy demo_leads_select on public.demo_leads
  for select to authenticated
  using (public.is_platform_admin());

-- No INSERT/UPDATE/DELETE policy: writes are service-role only (matches
-- usage_logs/webhook_events/notifications — see 0006_rls.sql / 0023_notifications.sql).
