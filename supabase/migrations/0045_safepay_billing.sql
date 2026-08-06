-- 0045_safepay_billing.sql
-- Local (Pakistan) billing provider alongside Stripe. Additive only.
--
-- WHY A SECOND PROVIDER AT ALL: Stripe does not onboard Pakistan-based
-- merchants, so a PKR-settling provider is the only way to charge Pakistani
-- tenants. Safepay is chosen because it exposes real subscription primitives
-- (create/cancel/pause + signed webhooks), so it maps onto the same hosted-
-- checkout + webhook-is-the-only-writer shape 0038 already established for
-- Stripe, rather than requiring a hand-rolled recurring scheduler.
--
-- ROUTING is by tenant country, not by tenant choice: a tenant who picks the
-- wrong provider gets a card decline they cannot self-diagnose.

-- Which billing provider this tenant transacts on. Deliberately NOT a DB enum:
-- matches the `payment_method` / `business_type` precedent (docs/11 §2.3) of
-- app-validated text for values that may grow. 'stripe' is the default so every
-- existing tenant keeps its current behaviour with no backfill.
alter table public.tenants
  add column if not exists billing_provider text not null default 'stripe',
  -- ISO-3166-1 alpha-2. Drives provider selection (PK => safepay). Nullable:
  -- unknown country falls back to the default provider rather than blocking.
  add column if not exists billing_country text,
  add column if not exists safepay_customer_id text,
  add column if not exists safepay_subscription_id text,
  -- The PKR minor-unit amount this tenant's Safepay subscription was created
  -- at. Safepay charges a FIXED recurring amount, so the USD->PKR rate is
  -- locked at subscribe time; storing it makes the recurring charge auditable
  -- and lets the webhook cross-check what was actually billed (§ amount check).
  add column if not exists safepay_amount_minor bigint,
  add column if not exists safepay_currency text;

alter table public.tenants drop constraint if exists tenants_billing_provider_check;
alter table public.tenants add constraint tenants_billing_provider_check
  check (billing_provider in ('stripe', 'safepay'));

-- Safepay webhook idempotency ledger. Mirrors stripe_events (0038) and
-- webhook_events exactly: service-role only, RLS on with NO policies, since
-- provider event ids are not customer data and nothing authenticated reads it.
create table if not exists public.safepay_events (
  id           text primary key,  -- Safepay's own event/tracker id — the idempotency key itself
  type         text not null,
  processed_at timestamptz not null default now()
);

alter table public.safepay_events enable row level security;
-- No policies: service-role only, same reasoning as stripe_events.

create index if not exists tenants_safepay_subscription_id_idx
  on public.tenants (safepay_subscription_id)
  where safepay_subscription_id is not null;
