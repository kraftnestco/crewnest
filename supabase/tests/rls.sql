-- supabase/tests/rls.sql
--
-- R2 (docs/17-QUALITY-AND-DATA-LIFECYCLE.md §1) — two-tenant Row Level Security
-- isolation probe. Formalises the rolled-back-transaction technique used ad hoc
-- in prior sessions into a committed, repeatable test.
--
-- Everything below runs inside ONE transaction that is always rolled back at
-- the very end, so this is safe to run against any environment that has the
-- migrations applied — nothing here is ever actually committed, including on
-- a shared/staging database (though CI, per .github/workflows/ci.yml, always
-- targets a disposable container).
--
-- Requires a Supabase-flavoured Postgres: the `auth` schema/roles (anon,
-- authenticated, service_role), `auth.uid()`, and the `storage` schema —
-- NOT a vanilla `postgres` image, which has none of those. CI uses the
-- `supabase/postgres` image for exactly this reason.
--
-- Run locally against a local `supabase start` stack:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls.sql
--
-- Fails loudly (RAISE EXCEPTION → non-zero psql exit) on the first isolation
-- breach, so CI can gate on it.

\set ON_ERROR_STOP on

\set admin_user      '00000000-0000-0000-0000-0000000000a1'
\set tenant_a_user    '00000000-0000-0000-0000-0000000000a2'
\set tenant_b_user    '00000000-0000-0000-0000-0000000000a3'
\set tenant_a         '00000000-0000-0000-0000-0000000000b1'
\set tenant_b         '00000000-0000-0000-0000-0000000000b2'
\set session_a1       '00000000-0000-0000-0000-0000000000c1'
\set session_b1       '00000000-0000-0000-0000-0000000000c2'

begin;

-- ── Assertion helper ────────────────────────────────────────────────────────
create or replace function pg_temp.assert_eq(description text, expected bigint, actual bigint)
returns void
language plpgsql
as $$
begin
  if expected is distinct from actual then
    raise exception 'RLS ASSERTION FAILED: % (expected %, got %)', description, expected, actual;
  end if;
  raise notice 'ok - %', description;
end;
$$;

-- ── Fixtures (run as the migration/superuser role, which bypasses RLS) ─────

-- CI's supabase/postgres image ships an older Auth schema where this column
-- is `confirmed_at`, not the more common `email_confirmed_at` — confirmed via
-- direct introspection (information_schema.columns) against the pinned image
-- version, not assumed. Real Supabase Auth accepts inserts either way in
-- practice, but the CI Postgres container has no Auth service running to
-- reconcile the difference, so it must match this container's actual columns.
insert into auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', :'admin_user'::uuid,   'authenticated', 'authenticated',
   'rls-test-admin@clerknest.test',    '', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', :'tenant_a_user'::uuid, 'authenticated', 'authenticated',
   'rls-test-tenant-a@clerknest.test', '', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', :'tenant_b_user'::uuid, 'authenticated', 'authenticated',
   'rls-test-tenant-b@clerknest.test', '', now(), now(), now(), '{}', '{}')
on conflict (id) do nothing;

-- `handle_new_user` (0007) already created the matching public.profiles rows.
update public.profiles set is_platform_admin = true where id = :'admin_user'::uuid;

insert into public.tenants (id, business_name)
values (:'tenant_a'::uuid, 'RLS Test Tenant A'), (:'tenant_b'::uuid, 'RLS Test Tenant B')
on conflict (id) do nothing;

insert into public.user_tenants (user_id, tenant_id, role)
values
  (:'tenant_a_user'::uuid, :'tenant_a'::uuid, 'tenant_admin'),
  (:'tenant_b_user'::uuid, :'tenant_b'::uuid, 'tenant_admin')
on conflict do nothing;

insert into public.chat_sessions (id, tenant_id, platform, external_user_id)
values
  (:'session_a1'::uuid, :'tenant_a'::uuid, 'whatsapp', 'rls-test-customer-a1'),
  (gen_random_uuid(),    :'tenant_a'::uuid, 'whatsapp', 'rls-test-customer-a2'),
  (:'session_b1'::uuid, :'tenant_b'::uuid, 'whatsapp', 'rls-test-customer-b1'),
  (gen_random_uuid(),    :'tenant_b'::uuid, 'whatsapp', 'rls-test-customer-b2');

insert into public.chat_messages (session_id, tenant_id, role, content)
values
  (:'session_a1'::uuid, :'tenant_a'::uuid, 'user', 'hi from tenant A customer'),
  (:'session_b1'::uuid, :'tenant_b'::uuid, 'user', 'hi from tenant B customer');

insert into public.orders (tenant_id, session_id, items)
values
  (:'tenant_a'::uuid, :'session_a1'::uuid, '[{"name":"Widget","qty":1}]'::jsonb),
  (:'tenant_b'::uuid, :'session_b1'::uuid, '[{"name":"Widget","qty":1}]'::jsonb);

insert into public.usage_logs (tenant_id, provider, model)
values (:'tenant_a'::uuid, 'openai', 'gpt-4o-mini'), (:'tenant_b'::uuid, 'openai', 'gpt-4o-mini');

insert into public.webhook_events (provider, provider_msg_id, tenant_id)
values ('whatsapp', 'rls-test-evt-a', :'tenant_a'::uuid), ('whatsapp', 'rls-test-evt-b', :'tenant_b'::uuid);

insert into public.demo_leads (email, business_name, business_type, intake_snapshot)
values ('rls-test-lead@clerknest.test', 'RLS Test Lead Co', 'product', '{}'::jsonb);

-- Agency-scope row for tenant A + one tenant-scope row per tenant — the exact
-- shape needed to prove the two notification audiences never cross (0023).
insert into public.notifications (scope, tenant_id, type, title, link)
values
  ('agency', :'tenant_a'::uuid, 'new_order', 'RLS test: new order (agency view)', '/admin/orders'),
  ('tenant', :'tenant_a'::uuid, 'new_order', 'RLS test: new order (tenant A view)', '/dashboard/orders'),
  ('tenant', :'tenant_b'::uuid, 'new_order', 'RLS test: new order (tenant B view)', '/dashboard/orders');

insert into storage.objects (bucket_id, name)
values
  ('order-media', :'tenant_a'::text || '/' || :'session_a1'::text || '/rls-test.jpg'),
  ('order-media', :'tenant_b'::text || '/' || :'session_b1'::text || '/rls-test.jpg');

-- ── Persona: tenant A member ────────────────────────────────────────────────
-- Sets BOTH conventions: the JSON blob (request.jwt.claims — what real
-- PostgREST/GoTrue set, and what a real Supabase project's auth.uid() reads
-- via a JSON-parsing wrapper) and the flat per-claim key (request.jwt.claim.sub
-- — what THIS CI Postgres image's simpler auth.uid() reads directly, confirmed
-- via introspecting its actual source: `nullif(current_setting
-- ('request.jwt.claim.sub', true), '')::uuid`). Belt-and-suspenders so this
-- fixture works regardless of which auth.uid() implementation is installed.
select set_config('request.jwt.claims', json_build_object('sub', :'tenant_a_user', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', :'tenant_a_user', true);
set local role authenticated;

select pg_temp.assert_eq('tenant A sees only its own chat_sessions', 2,
  (select count(*) from public.chat_sessions where tenant_id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
select pg_temp.assert_eq('tenant A sees only its own chat_messages', 1,
  (select count(*) from public.chat_messages where tenant_id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
select pg_temp.assert_eq('tenant A sees only its own orders', 1,
  (select count(*) from public.orders where tenant_id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
select pg_temp.assert_eq('tenant A sees only its own usage_logs', 1,
  (select count(*) from public.usage_logs where tenant_id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
select pg_temp.assert_eq('tenant A sees only its own tenants row', 1,
  (select count(*) from public.tenants where id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
select pg_temp.assert_eq('tenant A sees only its own user_tenants row', 1,
  (select count(*) from public.user_tenants where user_id in (:'tenant_a_user'::uuid, :'tenant_b_user'::uuid)));
select pg_temp.assert_eq('tenant A sees only its own order-media objects', 1,
  (select count(*) from storage.objects
    where bucket_id = 'order-media' and (storage.foldername(name))[1]::uuid in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
select pg_temp.assert_eq('tenant A cannot read webhook_events (admin-only)', 0,
  (select count(*) from public.webhook_events where tenant_id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
select pg_temp.assert_eq('tenant A cannot read demo_leads (admin-only)', 0,
  (select count(*) from public.demo_leads where email = 'rls-test-lead@clerknest.test'));
select pg_temp.assert_eq('tenant A sees only its own tenant-scope notification', 1,
  (select count(*) from public.notifications where scope = 'tenant' and tenant_id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
select pg_temp.assert_eq('tenant A sees no agency-scope notifications', 0,
  (select count(*) from public.notifications where scope = 'agency' and tenant_id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));

-- ── Persona: tenant B member (symmetric check) ──────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', :'tenant_b_user', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', :'tenant_b_user', true);

select pg_temp.assert_eq('tenant B sees only its own chat_sessions', 2,
  (select count(*) from public.chat_sessions where tenant_id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
select pg_temp.assert_eq('tenant B sees only its own chat_messages', 1,
  (select count(*) from public.chat_messages where tenant_id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
select pg_temp.assert_eq('tenant B sees only its own orders', 1,
  (select count(*) from public.orders where tenant_id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
select pg_temp.assert_eq('tenant B sees only its own usage_logs', 1,
  (select count(*) from public.usage_logs where tenant_id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
select pg_temp.assert_eq('tenant B sees only its own order-media objects', 1,
  (select count(*) from storage.objects
    where bucket_id = 'order-media' and (storage.foldername(name))[1]::uuid in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
select pg_temp.assert_eq('tenant B sees only its own tenant-scope notification', 1,
  (select count(*) from public.notifications where scope = 'tenant' and tenant_id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));

-- ── Persona: platform admin (sees all fixture rows; audiences still split) ──
select set_config('request.jwt.claims', json_build_object('sub', :'admin_user', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', :'admin_user', true);

select pg_temp.assert_eq('admin sees both tenants'' chat_sessions', 4,
  (select count(*) from public.chat_sessions where tenant_id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
select pg_temp.assert_eq('admin sees both tenants'' orders', 2,
  (select count(*) from public.orders where tenant_id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
select pg_temp.assert_eq('admin sees both tenants'' usage_logs', 2,
  (select count(*) from public.usage_logs where tenant_id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
select pg_temp.assert_eq('admin sees both tenants'' rows', 2,
  (select count(*) from public.tenants where id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
select pg_temp.assert_eq('admin sees both order-media objects', 2,
  (select count(*) from storage.objects
    where bucket_id = 'order-media' and (storage.foldername(name))[1]::uuid in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
select pg_temp.assert_eq('admin sees the webhook_events fixture rows', 2,
  (select count(*) from public.webhook_events where tenant_id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
select pg_temp.assert_eq('admin sees the demo_leads fixture row', 1,
  (select count(*) from public.demo_leads where email = 'rls-test-lead@clerknest.test'));
select pg_temp.assert_eq('admin sees the agency-scope notification', 1,
  (select count(*) from public.notifications where scope = 'agency' and tenant_id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
-- The load-bearing "audiences don't cross" case (0023): a platform admin is
-- NOT a direct member of either tenant, so the tenant-scope policy (direct
-- membership only, not user_can_access_tenant) must hide BOTH tenant rows,
-- even though is_platform_admin() is true.
select pg_temp.assert_eq('admin does NOT see tenant-scope notifications (audiences must not cross)', 0,
  (select count(*) from public.notifications where scope = 'tenant' and tenant_id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));

-- ── Persona: anon (no policy grants it anything) ────────────────────────────
select set_config('request.jwt.claims', '', true);
set local role anon;

select pg_temp.assert_eq('anon sees no chat_sessions', 0,
  (select count(*) from public.chat_sessions where tenant_id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
select pg_temp.assert_eq('anon sees no chat_messages', 0,
  (select count(*) from public.chat_messages where tenant_id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
select pg_temp.assert_eq('anon sees no orders', 0,
  (select count(*) from public.orders where tenant_id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
select pg_temp.assert_eq('anon sees no usage_logs', 0,
  (select count(*) from public.usage_logs where tenant_id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
select pg_temp.assert_eq('anon sees no tenants rows', 0,
  (select count(*) from public.tenants where id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
select pg_temp.assert_eq('anon sees no notifications', 0,
  (select count(*) from public.notifications where tenant_id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
select pg_temp.assert_eq('anon sees no webhook_events', 0,
  (select count(*) from public.webhook_events where tenant_id in (:'tenant_a'::uuid, :'tenant_b'::uuid)));
select pg_temp.assert_eq('anon sees no demo_leads', 0,
  (select count(*) from public.demo_leads where email = 'rls-test-lead@clerknest.test'));
select pg_temp.assert_eq('anon sees no order-media objects', 0,
  (select count(*) from storage.objects
    where bucket_id = 'order-media' and (storage.foldername(name))[1]::uuid in (:'tenant_a'::uuid, :'tenant_b'::uuid)));

do $$ begin raise notice 'ALL RLS ISOLATION ASSERTIONS PASSED'; end $$;

rollback;
