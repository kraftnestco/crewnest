-- 0011_custom_orders_media.sql
-- Custom-order intake config + media attachment columns (Stage E). See
-- docs/10-CUSTOM-ORDERS-MEDIA-AND-INTAKE.md §2.4. All additive, default off ⇒
-- no behaviour change for existing tenants.
--
-- The `order-media` Storage bucket + its RLS policies are a SEPARATE,
-- [OPUS]-gated step (Stage E4, docs/10 §11) — deliberately NOT in this migration.

alter table public.tenants
  add column if not exists custom_orders_enabled          boolean not null default false,
  add column if not exists custom_orders_require_approval  boolean not null default true,
  add column if not exists custom_order_instructions       text,
  add column if not exists media_handling                  text default 'match_catalogue';

alter table public.chat_messages add column if not exists attachments jsonb;
alter table public.orders        add column if not exists attachments jsonb;   -- [{ kind, storagePath, mimeType }]
