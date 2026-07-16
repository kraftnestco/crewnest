-- 0009_orders.sql
-- Orders domain (Phase 2 tool-calling). See docs/09-ORDERS-AND-TOOLS.md §3.1.
-- Independent of 0008_pgmq.sql (Phase 3); can be applied without it.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type order_status as enum ('pending','confirmed','cancelled','fulfilled');
  end if;
end $$;

create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  session_id        uuid references public.chat_sessions(id) on delete set null,
  status            order_status not null default 'confirmed',
  customer_name     text,
  customer_phone    text,
  customer_address  text,
  items             jsonb not null default '[]'::jsonb,   -- [{ name, qty, price?, sku?, customization? }]
  notes             text,
  platform          platform,
  external_user_id  text,
  owner_notified_at timestamptz,                          -- set once the owner push succeeds (§4)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists orders_tenant_created_idx on public.orders (tenant_id, created_at desc);
create index if not exists orders_status_idx        on public.orders (tenant_id, status);

alter table public.orders enable row level security;

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
  for select to authenticated using (public.user_can_access_tenant(tenant_id));
-- INSERT/UPDATE via service role only (bypasses RLS), matching usage_logs. No authenticated write
-- policy in Phase 2 unless manual order entry from the dashboard is wanted.

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;   -- live Orders tab
  end if;
end $$;
