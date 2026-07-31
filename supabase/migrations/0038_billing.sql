-- 0038_billing.sql
-- docs/22-BILLING-STRIPE.md §5. Additive only.
--
-- plan_status was previously "app-validated" only (0025's own comment) — no DB
-- constraint existed. This is the first real check constraint on it, adding
-- 'payment_failed' (docs/22 §2.4) alongside the two values already in use
-- (`pending_upgrade`, `cap_reached`) plus null (no status).

alter table public.tenants
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text;

alter table public.tenants drop constraint if exists tenants_plan_status_check;
alter table public.tenants add constraint tenants_plan_status_check
  check (plan_status is null or plan_status in ('pending_upgrade', 'cap_reached', 'payment_failed'));

-- Stripe webhook idempotency ledger (docs/22 §2.3), mirroring webhook_events'
-- posture exactly: service-role only, no RLS-authenticated access, since
-- Stripe event ids are not customer data and nothing authenticated ever needs
-- to read this table directly.
create table if not exists public.stripe_events (
  id           text primary key,  -- Stripe's own event.id — the idempotency key itself
  type         text not null,
  processed_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;
-- No policies: service-role only, same reasoning as webhook_events/rate_limit_buckets.
