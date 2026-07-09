# 03 — Database, Roles & RLS

The runnable version of everything here lives in [`../supabase/migrations/`](../supabase/migrations/).
This doc explains the *why* so implementation and audits stay honest.

---

## 1. Entity overview

```
auth.users (Supabase)
     │ 1:1
     ▼
  profiles ──────────────┐
     │ 1:N               │ platform_admin? (bool) → sees all tenants
     ▼                   │
 user_tenants  N:1 ── tenants ──1:N── chat_sessions ──1:N── chat_messages
 (membership+role)      │                    │
                        │                    └── usage_logs (per message/turn)
                        └── secrets stored in Vault; row holds only references
 webhook_events (idempotency ledger, tenant-scoped)
```

Design principles:
- **Every tenant-owned row carries `tenant_id`** (even where derivable) so RLS policies are simple,
  fast, and index-friendly.
- **Secrets are never columns of plaintext.** `tenants` stores Vault secret *references*.
- **Enums** for closed sets (`platform`, `message_role`, `member_role`).

---

## 2. Enums

```sql
create type platform     as enum ('whatsapp','facebook','instagram','web','voice');
create type message_role as enum ('system','user','assistant','tool'); -- 'tool' reserved for Phase 2
create type member_role  as enum ('platform_admin','tenant_admin','tenant_agent');
```

## 3. Tables

### `profiles` (1:1 with `auth.users`)
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | = `auth.users.id` (FK, on delete cascade) |
| `email` | text | mirror for display |
| `full_name` | text | nullable |
| `is_platform_admin` | boolean | default `false` — **the agency super-admin flag** |
| `created_at` | timestamptz | default `now()` |

Created via a trigger on `auth.users` insert (see triggers migration).

### `user_tenants` (membership; a user can belong to many tenants)
| Column | Type | Notes |
|--------|------|-------|
| `user_id` | uuid FK→profiles | |
| `tenant_id` | uuid FK→tenants | |
| `role` | member_role | `tenant_admin` / `tenant_agent` (Phase 2 client logins) |
| PK | (`user_id`,`tenant_id`) | |

Phase 1: only platform admins log in, so this table may be empty — but policies use it now so client
logins in Phase 2 need **no policy rewrite**.

### `tenants`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | default `gen_random_uuid()` |
| `business_name` | text not null | |
| `slug` | text unique | for dashboard URLs |
| `meta_page_id` | text | **indexed**, unique-nullable — FB/IG routing key |
| `instagram_id` | text | **indexed** — IG business account id (may differ from page) |
| `whatsapp_phone_number_id` | text | **indexed**, unique-nullable — WA routing key |
| `sip_trunk_id` | text | **indexed** — Phase 3 |
| `shopify_store_url` | text | Phase 2 |
| `system_prompt` | text not null | brand persona + language rules (e.g. Roman-Urdu/English code-switching). Static ⇒ cache-friendly. |
| `catalog_data` | jsonb not null default `'{}'` | RAG-ready structured catalogue; served in the cached leading block |
| `llm_provider` | text not null default `'openai'` | provider key for the abstraction |
| `llm_model` | text not null default `'gpt-4o-mini'` | per-tenant model |
| `openai_key_secret_id` | uuid | **Vault** reference to BYOK key; null ⇒ use `MASTER_OPENAI_KEY` |
| `meta_token_secret_id` | uuid | **Vault** reference to Page access token |
| `whatsapp_token_secret_id` | uuid | **Vault** reference to WhatsApp token |
| `widget_public_key` | text unique | **indexed** — website widget routing (public, not secret) |
| `widget_allowed_origins` | text[] default `'{}'` | origin allowlist for the widget |
| `is_active` | boolean default `true` | inactive ⇒ webhooks ignore |
| `created_at`/`updated_at` | timestamptz | `updated_at` maintained by trigger |

> **Token model note (locked decision):** these `*_secret_id` columns work for both manual token
> paste *and* future embedded-signup OAuth — OAuth just writes a fresh Vault secret and updates the
> reference. No schema change needed later.

### `chat_sessions`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_id` | uuid FK→tenants | **on delete cascade** |
| `platform` | platform | |
| `external_user_id` | text not null | **indexed** — the sender id on that platform |
| `is_human_handoff` | boolean default `false` | true ⇒ AI is muted for this session |
| `last_message_at` | timestamptz | for inbox sort; maintained by trigger |
| `unread_count` | int default `0` | for inbox badges |
| `created_at` | timestamptz | |
| unique | (`tenant_id`,`platform`,`external_user_id`) | one session per customer per channel |

### `chat_messages`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `session_id` | uuid FK→chat_sessions | **on delete cascade** |
| `tenant_id` | uuid FK→tenants | denormalised for RLS/index |
| `role` | message_role | |
| `content` | text not null | sanitised before insert |
| `provider_msg_id` | text | nullable; helps trace |
| `token_count` | int | nullable; for metering |
| `created_at` | timestamptz | **indexed** with session for history reads |

### `usage_logs` (per-turn metering — SaaS billing/cost foundation)
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_id` | uuid FK→tenants | **indexed** |
| `session_id` | uuid FK→chat_sessions | nullable |
| `provider` | text | e.g. `openai` |
| `model` | text | |
| `prompt_tokens` / `completion_tokens` / `total_tokens` | int | |
| `estimated_cost_usd` | numeric(10,6) | computed from a rate table in code |
| `used_byok` | boolean | true if tenant key, false if master fallback |
| `created_at` | timestamptz | **indexed** for period rollups |

### `webhook_events` (idempotency ledger)
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `provider` | text | `meta` / `shopify` |
| `provider_msg_id` | text not null | |
| `tenant_id` | uuid | nullable if unresolved |
| `received_at` | timestamptz default `now()` | |
| unique | (`provider`,`provider_msg_id`) | **the dedupe key** |

---

## 4. Roles & authorization model

Three principals:

1. **`platform_admin`** (you / agency staff): `profiles.is_platform_admin = true`. Sees and manages
   **all** tenants and all conversations. This is the Phase-1 dashboard user.
2. **Tenant member** (Phase 2 client logins): row(s) in `user_tenants` with `tenant_admin` or
   `tenant_agent`. Scoped to their tenant(s) only.
3. **Service role** (server-only automation): bypasses RLS; used by webhook/`after()` code for
   destination→tenant resolution and cross-tenant writes. **Never** reaches the browser.

### Helper functions (SQL, `SECURITY DEFINER`, `stable`)
```sql
-- true if the current JWT belongs to a platform admin
create function public.is_platform_admin() returns boolean ...
  -- select coalesce((select is_platform_admin from profiles where id = auth.uid()), false)

-- true if current user may access a given tenant (admin OR member)
create function public.user_can_access_tenant(t uuid) returns boolean ...
  -- is_platform_admin() OR exists(select 1 from user_tenants where user_id = auth.uid() and tenant_id = t)
```
Mark them `stable` and set a safe `search_path`. They keep every policy a one-liner and let Phase 2
client logins work without touching policies.

---

## 5. RLS policy model

**Enable RLS on all of:** `profiles`, `user_tenants`, `tenants`, `chat_sessions`, `chat_messages`,
`usage_logs`, `webhook_events`. Then:

| Table | SELECT | INSERT / UPDATE / DELETE |
|-------|--------|--------------------------|
| `profiles` | self (`id = auth.uid()`) or platform_admin | self update; platform_admin all |
| `user_tenants` | platform_admin, or rows where `user_id = auth.uid()` | platform_admin only (they assign membership) |
| `tenants` | `user_can_access_tenant(id)` | platform_admin only (Phase 1); tenant_admin update-own (Phase 2) |
| `chat_sessions` | `user_can_access_tenant(tenant_id)` | same |
| `chat_messages` | `user_can_access_tenant(tenant_id)` | insert allowed for accessible tenant (manual send); AI writes go via service role |
| `usage_logs` | `user_can_access_tenant(tenant_id)` | service role writes; no client insert |
| `webhook_events` | platform_admin only | service role only |

Notes:
- Policies target the `authenticated` role. The service-role key **bypasses RLS by design** — that is
  why it is confined to server-only code.
- **Realtime:** `postgres_changes` respects these table policies automatically (confirmed in Supabase
  docs). So the live inbox subscribing to `chat_messages`/`chat_sessions` needs **no** separate
  `realtime.messages` broadcast policy — a client only receives change events for rows its RLS allows.
  Add the tables to the `supabase_realtime` publication.
- Add indexes backing every policy predicate (`tenant_id` on all scoped tables; `user_tenants`
  composite PK covers membership checks).

---

## 6. Vault helpers (BYOK)

```sql
-- store/replace a tenant secret, return its uuid (service-role only)
create function public.set_tenant_secret(p_name text, p_value text) returns uuid ...
  -- wraps vault.create_secret / vault.update_secret

-- read a tenant secret by uuid; SECURITY DEFINER; callable only by service role
create function public.get_tenant_secret(p_secret_id uuid) returns text ...
  -- select decrypted_secret from vault.decrypted_secrets where id = p_secret_id
```
- These live in `public` **only because PostgREST RPC can reach exposed schemas** — the service
  client calls them via `.rpc()`. They are locked down by **grants**: `revoke execute from public,
  anon, authenticated` and `grant execute to service_role`. A non-exposed `private` schema would be
  tidier but unreachable by the service client, so grants are the enforcement mechanism here.
- `vault.decrypted_secrets` must have **no** `anon`/`authenticated` grants.
- Application code calls `get_tenant_secret` via the **service-role** client, uses the value in
  memory, and never stores/logs it. See [`02-SECURITY.md`](./02-SECURITY.md) §2.

---

## 7. Triggers

- `on_auth_user_created`: insert a `profiles` row when `auth.users` gets a new row.
- `set_updated_at`: maintain `tenants.updated_at`.
- `bump_session_on_message`: on `chat_messages` insert, update the parent `chat_sessions.last_message_at`
  and (for inbound) increment `unread_count`.

---

## 8. Migration file order

```
0001_extensions.sql      -- pgcrypto (gen_random_uuid); note: enable "supabase_vault" in dashboard
0002_enums.sql           -- platform, message_role, member_role
0003_tables.sql          -- profiles, user_tenants, tenants, chat_sessions, chat_messages, usage_logs, webhook_events
0004_indexes.sql         -- routing keys, tenant_id, history, usage rollups
0005_functions.sql       -- is_platform_admin(), user_can_access_tenant(), vault helpers
0006_rls.sql             -- enable RLS + all policies + realtime publication
0007_triggers.sql        -- profiles auto-create, updated_at, session bump
0008_pgmq.sql            -- OPTIONAL / Phase 3: enable pgmq + create 'inbound_messages' queue
```
Each migration is idempotent-friendly (`if not exists` / `create or replace`) where possible so
re-running during dev is safe.
