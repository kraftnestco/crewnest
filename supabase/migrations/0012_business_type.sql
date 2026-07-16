-- 0012_business_type.sql
-- Product-vs-service business framing, driving which order/service flow the
-- prompt shows. Additive, default 'product' ⇒ no behaviour change for
-- existing tenants (identical to media_handling's text+app-validated pattern
-- from 0011 — no DB-level check constraint, validated in the intake action).

alter table public.tenants
  add column if not exists business_type text not null default 'product', -- 'product' | 'service'
  add column if not exists booking_link  text;                            -- service tenants only, optional
