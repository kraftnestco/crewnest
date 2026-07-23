-- 0031_lifecycle.sql
-- Stage S3 + Stage T (docs/17-QUALITY-AND-DATA-LIFECYCLE.md §3.3, §4, §5). Additive only.
--
-- Cron note: doc-17 §3.1 offers two options for the daily maintenance job — a Supabase
-- pg_cron job, or "a Vercel Cron hitting an authenticated internal route." The retention
-- sweep and erasure functions in services/dataLifecycle.ts must delete real Supabase
-- Storage objects (S3-backed), which plain SQL/pg_cron cannot reach — only the Storage
-- SDK can. So this migration registers no pg_cron job; runDailyMaintenance() is plain
-- TypeScript, scheduled by vercel.json's `crons` array. No pg_cron extension needed.

-- ---------------------------------------------------------------------------
-- S3 — per-tenant daily cost alert threshold. Null = no alert (safe default).
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column if not exists daily_cost_alert_usd numeric(10,2);

-- ---------------------------------------------------------------------------
-- T §4.3 — retention. Null = keep forever (safe default, no silent deletion).
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column if not exists message_retention_days int;

-- ---------------------------------------------------------------------------
-- T §4.2 — scrub-and-retain: PII cleared on an order, shell kept for the
-- tenant's own transactional/financial records.
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists pii_erased_at timestamptz;

-- ---------------------------------------------------------------------------
-- T §4.4 — erasure audit trail. Service-role write only (dataLifecycle.ts runs
-- on the service client); agency-read, mirroring usage_logs/webhook_events.
--
-- tenant_id is deliberately a plain uuid, NOT a foreign key to tenants(id).
-- eraseTenant() writes its audit row, then deletes the tenant row; an
-- `on delete cascade` FK would delete this very row in the same transaction,
-- destroying the proof-of-erasure record it exists to preserve. An audit
-- trail must outlive the thing it audits.
-- ---------------------------------------------------------------------------
create table if not exists public.erasure_events (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null,
  subject_platform          platform,                    -- null for a tenant-wide erasure
  subject_external_user_id  text,                         -- null for a tenant-wide erasure
  scope                     text not null,
  requested_by              uuid references public.profiles(id) on delete set null,
  storage_objects_deleted   int not null default 0,
  completed_at              timestamptz not null default now(),
  note                      text
);

alter table public.erasure_events drop constraint if exists erasure_events_scope_check;
alter table public.erasure_events add constraint erasure_events_scope_check
  check (scope in ('customer', 'tenant'));

create index if not exists erasure_events_tenant_completed_idx
  on public.erasure_events (tenant_id, completed_at desc);

alter table public.erasure_events enable row level security;

drop policy if exists erasure_events_select on public.erasure_events;
create policy erasure_events_select on public.erasure_events
  for select to authenticated
  using (public.is_platform_admin());
-- No insert/update/delete policy — service-role only (bypasses RLS), same as usage_logs.

-- ---------------------------------------------------------------------------
-- T §4.1 — Vault secrets are not FK-linked to public.*, so a tenant cascade
-- drops only the *reference*; the secret itself is orphaned. eraseTenant()
-- needs a way to explicitly vault.delete_secret() it. Mirrors the
-- set_tenant_secret/get_tenant_secret security-definer pattern (0005_functions.sql).
-- ---------------------------------------------------------------------------
create or replace function public.delete_tenant_secret(p_secret_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform vault.delete_secret(p_secret_id);
end;
$$;

revoke all on function public.delete_tenant_secret(uuid) from public, anon, authenticated;
grant execute on function public.delete_tenant_secret(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Pulled forward from Stage P (docs/15-RELIABILITY.md §7 assigns 'system_alert'
-- to migration 0029_reliability.sql). Narrow, disclosed exception to build
-- order: this is an inert schema value with no behavioral dependency on the
-- rest of Stage P (webhook/queue/Edge Function cutover, still untouched and
-- deferred). Widening the constraint here is additive and idempotent, so
-- 0029 can safely redefine the same constraint again later with no conflict.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'new_order','handoff','alert_signal','channel_request','payment_proof',
    'upgrade_request','review','order_updated','media_review','system_alert'
  ));
