-- 0004_indexes.sql
-- Indexes backing routing lookups, RLS predicates, and hot reads.

-- Tenant routing keys (webhook destination -> tenant). Partial: only non-null.
create unique index if not exists tenants_meta_page_id_uidx
  on public.tenants (meta_page_id) where meta_page_id is not null;
create unique index if not exists tenants_wa_phone_id_uidx
  on public.tenants (whatsapp_phone_number_id) where whatsapp_phone_number_id is not null;
create index if not exists tenants_instagram_id_idx
  on public.tenants (instagram_id) where instagram_id is not null;
create index if not exists tenants_sip_trunk_id_idx
  on public.tenants (sip_trunk_id) where sip_trunk_id is not null;
create unique index if not exists tenants_widget_public_key_uidx
  on public.tenants (widget_public_key) where widget_public_key is not null;

-- RLS predicate support (tenant_id on every scoped table).
create index if not exists chat_sessions_tenant_idx on public.chat_sessions (tenant_id);
create index if not exists chat_messages_tenant_idx on public.chat_messages (tenant_id);
create index if not exists usage_logs_tenant_idx    on public.usage_logs (tenant_id);

-- Session lookup by external user (find-or-create) and inbox sort.
create index if not exists chat_sessions_lookup_idx
  on public.chat_sessions (tenant_id, platform, external_user_id);
create index if not exists chat_sessions_inbox_sort_idx
  on public.chat_sessions (tenant_id, last_message_at desc);

-- Message history reads (chronological within a session).
create index if not exists chat_messages_history_idx
  on public.chat_messages (session_id, created_at);

-- Usage rollups by period.
create index if not exists usage_logs_period_idx
  on public.usage_logs (tenant_id, created_at desc);
