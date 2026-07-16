-- 0010_orders_tenant_cols.sql
-- Per-tenant orders config. See docs/09-ORDERS-AND-TOOLS.md §3.1.

alter table public.tenants add column if not exists orders_enabled        boolean not null default false;
alter table public.tenants add column if not exists owner_notify_whatsapp text;      -- owner's WA number, E.164
alter table public.tenants add column if not exists owner_notify_template text;      -- approved template name (§4)
