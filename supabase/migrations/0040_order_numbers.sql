-- 0040_order_numbers.sql
-- Human-readable, per-tenant sequential order numbers for customer-facing
-- messages. `orders.id` (uuid) is unreadable in a message a real customer
-- reads on their phone — every order-lifecycle message currently interpolates
-- the raw uuid (e.g. "Your payment for order #f2c7191d-394d-44d3-9f23-...").
-- `order_number` replaces that: #1, #2, #3... independently per tenant, so a
-- business owner can also gauge order volume ("we're at #142") at a glance.

alter table public.tenants
  add column if not exists next_order_number integer not null default 1;

alter table public.orders
  add column if not exists order_number integer;

-- Backfill existing orders in creation order, per tenant, so historical orders
-- get a sensible #1, #2, #3... instead of staying null forever. row_number()
-- over (partition by tenant_id order by created_at) is exactly "the Nth order
-- this tenant ever placed".
with numbered as (
  select id, row_number() over (partition by tenant_id order by created_at) as rn
  from public.orders
  where order_number is null
)
update public.orders o
set order_number = numbered.rn
from numbered
where o.id = numbered.id;

-- Advance each tenant's counter past whatever backfill just assigned, so the
-- NEXT real order continues the sequence instead of restarting at 1.
update public.tenants t
set next_order_number = coalesce((
  select max(o.order_number) + 1 from public.orders o where o.tenant_id = t.id
), 1)
where exists (select 1 from public.orders o where o.tenant_id = t.id);

create unique index if not exists orders_tenant_order_number_idx
  on public.orders (tenant_id, order_number);

-- Atomically claim the next number for a tenant. The UPDATE itself is the
-- serialization point (Postgres row-locks the tenant row for the duration),
-- so two concurrent orders for the same tenant can never claim the same
-- number — no separate advisory lock needed, unlike create_order_atomic's
-- per-session dedupe lock (migration 0021), which this is independent of.
create or replace function public.claim_next_order_number(p_tenant_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.tenants
     set next_order_number = next_order_number + 1
   where id = p_tenant_id
  returning next_order_number - 1;
$$;

revoke all on function public.claim_next_order_number(uuid) from public, anon, authenticated;
grant execute on function public.claim_next_order_number(uuid) to service_role;

-- create_order_atomic (migration 0021) now claims + stamps order_number in the
-- SAME transaction as the insert, so a crash between claiming a number and
-- inserting the row is impossible — the number is claimed by the function
-- itself, inline, not by a separate round trip from the TS caller.
create or replace function public.create_order_atomic(
  p_tenant_id uuid,
  p_session_id uuid,
  p_platform public.platform,
  p_external_user_id text,
  p_items jsonb,
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text,
  p_notes text,
  p_status public.order_status,
  p_attachments jsonb,
  p_payment_method text,
  p_amount_total numeric,
  p_currency text,
  p_fingerprint text,
  p_dedupe_window_minutes int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_order_number integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));

  if exists (
    select 1 from public.orders
    where session_id = p_session_id
      and dedupe_fingerprint = p_fingerprint
      and created_at >= now() - make_interval(mins => p_dedupe_window_minutes)
  ) then
    return jsonb_build_object('is_duplicate', true);
  end if;

  update public.tenants
     set next_order_number = next_order_number + 1
   where id = p_tenant_id
  returning next_order_number - 1 into v_order_number;

  insert into public.orders (
    tenant_id, session_id, platform, external_user_id, items, customer_name,
    customer_phone, customer_address, notes, status, attachments,
    payment_method, amount_total, currency, dedupe_fingerprint, order_number
  ) values (
    p_tenant_id, p_session_id, p_platform, p_external_user_id, p_items, p_customer_name,
    p_customer_phone, p_customer_address, p_notes, p_status, p_attachments,
    p_payment_method, p_amount_total, p_currency, p_fingerprint, v_order_number
  )
  returning * into v_order;

  return to_jsonb(v_order) || jsonb_build_object('is_duplicate', false);
end;
$$;

revoke all on function public.create_order_atomic(
  uuid, uuid, public.platform, text, jsonb, text, text, text, text,
  public.order_status, jsonb, text, numeric, text, text, int
) from public, anon, authenticated;
grant execute on function public.create_order_atomic(
  uuid, uuid, public.platform, text, jsonb, text, text, text, text,
  public.order_status, jsonb, text, numeric, text, text, int
) to service_role;
