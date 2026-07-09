-- 0003_tables.sql
-- Core schema. See docs/03-DATABASE.md for rationale.

-- 1:1 with auth.users. Holds the platform-admin (agency) flag.
create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              text,
  full_name          text,
  is_platform_admin  boolean not null default false,
  created_at         timestamptz not null default now()
);

-- Tenants (clients). Secrets are Vault references, never plaintext.
create table if not exists public.tenants (
  id                        uuid primary key default gen_random_uuid(),
  business_name             text not null,
  slug                      text unique,
  -- Meta routing keys
  meta_page_id              text,
  instagram_id              text,
  whatsapp_phone_number_id  text,
  sip_trunk_id              text,                 -- Phase 3
  shopify_store_url         text,                 -- Phase 2
  -- AI config (static => cache-friendly)
  system_prompt             text not null default '',
  catalog_data              jsonb not null default '{}'::jsonb,
  llm_provider              text not null default 'openai',
  llm_model                 text not null default 'gpt-4o-mini',
  -- Vault secret references (uuid from vault.create_secret); null => use master fallback
  openai_key_secret_id      uuid,
  meta_token_secret_id      uuid,
  whatsapp_token_secret_id  uuid,
  -- Website widget (public key is NOT a secret)
  widget_public_key         text unique,
  widget_allowed_origins    text[] not null default '{}',
  is_active                 boolean not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- Membership: which users belong to which tenants (Phase 2 client logins).
create table if not exists public.user_tenants (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id)  on delete cascade,
  role       member_role not null default 'tenant_agent',
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

-- One conversation per customer per channel.
create table if not exists public.chat_sessions (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  platform          platform not null,
  external_user_id  text not null,
  is_human_handoff  boolean not null default false,
  last_message_at   timestamptz not null default now(),
  unread_count      integer not null default 0,
  created_at        timestamptz not null default now(),
  unique (tenant_id, platform, external_user_id)
);

-- Messages. tenant_id denormalised for simple/fast RLS.
create table if not exists public.chat_messages (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.chat_sessions(id) on delete cascade,
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  role             message_role not null,
  content          text not null,
  provider_msg_id  text,
  token_count      integer,
  created_at       timestamptz not null default now()
);

-- Per-turn metering for billing/cost/abuse.
create table if not exists public.usage_logs (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  session_id         uuid references public.chat_sessions(id) on delete set null,
  provider           text not null,
  model              text not null,
  prompt_tokens      integer not null default 0,
  completion_tokens  integer not null default 0,
  total_tokens       integer not null default 0,
  estimated_cost_usd numeric(10,6) not null default 0,
  used_byok          boolean not null default false,
  created_at         timestamptz not null default now()
);

-- Idempotency ledger: defeats provider retries / double-replies.
create table if not exists public.webhook_events (
  id               uuid primary key default gen_random_uuid(),
  provider         text not null,
  provider_msg_id  text not null,
  tenant_id        uuid references public.tenants(id) on delete set null,
  received_at      timestamptz not null default now(),
  unique (provider, provider_msg_id)
);
