-- 0049_instagram_business_login.sql
-- Standalone "Connect with Instagram" (Meta's Instagram API with Instagram
-- Login — no linked Facebook Page required). This is a DIFFERENT token type
-- from meta_token_secret_id (an Instagram User access token for
-- graph.instagram.com, not a Facebook Page token for graph.facebook.com), so
-- it gets its own Vault-reference column, mirroring whatsapp_token_secret_id.
--
-- instagram_id already exists (0003_tables.sql) and is reused as-is: it holds
-- the underlying Instagram professional account id regardless of which OAuth
-- flow produced the token, since that id is the same value either way.
-- Promoting it to a unique index (like meta_page_id and whatsapp_phone_number_id
-- already are) closes a gap opened by this second connect path: without it, two
-- tenants could both claim the same Instagram account.

alter table public.tenants
  add column if not exists instagram_token_secret_id uuid;

drop index if exists public.tenants_instagram_id_idx;

create unique index if not exists tenants_instagram_id_uidx
  on public.tenants (instagram_id) where instagram_id is not null;
