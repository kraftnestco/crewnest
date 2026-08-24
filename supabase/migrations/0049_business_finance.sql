-- 0049_business_finance.sql
-- Operating expenses for owner-facing profit tracking (catalog unit_cost lives
-- in tenants.catalog_data JSON — no column change needed). Additive only.

create table if not exists public.business_expenses (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  label         text not null,
  amount        numeric(12, 2) not null check (amount >= 0),
  category      text not null default 'general',
  expense_date  date not null default current_date,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.business_expenses drop constraint if exists business_expenses_category_check;
alter table public.business_expenses add constraint business_expenses_category_check
  check (category in ('general', 'rent', 'marketing', 'shipping', 'payroll', 'utilities', 'supplies', 'other'));

create index if not exists business_expenses_tenant_date_idx
  on public.business_expenses (tenant_id, expense_date desc);

drop trigger if exists business_expenses_set_updated_at on public.business_expenses;
create trigger business_expenses_set_updated_at
  before update on public.business_expenses
  for each row execute function public.set_updated_at();

alter table public.business_expenses enable row level security;

drop policy if exists business_expenses_select on public.business_expenses;
create policy business_expenses_select on public.business_expenses
  for select to authenticated
  using (public.user_can_access_tenant(tenant_id));

drop policy if exists business_expenses_write on public.business_expenses;
create policy business_expenses_write on public.business_expenses
  for all to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1 from public.user_tenants ut
      where ut.tenant_id = business_expenses.tenant_id
        and ut.user_id = auth.uid()
        and ut.role = 'tenant_admin'
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1 from public.user_tenants ut
      where ut.tenant_id = business_expenses.tenant_id
        and ut.user_id = auth.uid()
        and ut.role = 'tenant_admin'
    )
  );
