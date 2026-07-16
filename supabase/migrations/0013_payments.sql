-- 0013_payments.sql
-- Payment collection foundations (Stage J). Money is a SEPARATE axis from the
-- fulfilment lifecycle (order_status) — see docs/11-PAYMENTS-AND-ORDER-LIFECYCLE.md
-- §1.1/§2.1. All additive; payments_enabled defaults false ⇒ no behaviour change
-- for existing tenants.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type payment_status as enum ('unpaid','awaiting_verification','paid','refunded','failed');
  end if;
end $$;

alter table public.orders
  add column if not exists payment_status    payment_status not null default 'unpaid',
  add column if not exists payment_method     text,          -- 'cod' | 'manual_transfer' | 'gateway' (app-validated, §2.3)
  add column if not exists payment_provider   text,          -- gateway key (Stage L); null for cod/manual
  add column if not exists payment_reference  text,          -- gateway charge/intent id OR a manual txn reference
  add column if not exists amount_total       numeric(12,2), -- server-set (§3.3, §6.2); null until priced
  add column if not exists currency           text,          -- ISO-4217, e.g. 'PKR'; defaults from tenant
  add column if not exists paid_at            timestamptz,
  add column if not exists payment_proof      jsonb;         -- { kind:'image', storagePath, mimeType } — Stage K, reuses doc 10 media

-- Per-tenant payment configuration. Default = COD-only, no external calls ⇒ no behaviour change.
alter table public.tenants
  add column if not exists payments_enabled      boolean not null default false,
  add column if not exists payment_methods        text[]  not null default '{cod}',  -- subset of {cod, manual_transfer, gateway}
  add column if not exists payment_instructions   text,    -- free-form account details (JazzCash/Easypaisa/bank), folded into prompt (§3.2)
  add column if not exists payment_provider        text,   -- gateway key (Stage L)
  add column if not exists payment_key_secret_id   uuid,   -- Vault ref to gateway API key (Stage L), like openai_key_secret_id
  add column if not exists default_currency        text not null default 'PKR',
  add column if not exists prepaid_required         boolean not null default false; -- true ⇒ tell the customer the order is reserved until paid

-- No new RLS and no new table: orders/tenants already carry the existing policies
-- (migration 0006/0009) which the new columns inherit unchanged.
