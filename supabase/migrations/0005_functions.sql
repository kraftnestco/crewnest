-- 0005_functions.sql
-- Authorization helpers (used by RLS) and Vault secret helpers (BYOK).
-- All SECURITY DEFINER functions pin search_path = '' and fully-qualify names.

-- ---------------------------------------------------------------------------
-- Authorization helpers
-- SECURITY DEFINER so they can read profiles/user_tenants regardless of RLS,
-- which avoids recursive policy evaluation.
-- ---------------------------------------------------------------------------

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_platform_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

create or replace function public.user_can_access_tenant(t uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_platform_admin()
    or exists (
      select 1 from public.user_tenants ut
      where ut.user_id = auth.uid() and ut.tenant_id = t
    );
$$;

-- Callable by signed-in users (policies run as `authenticated`).
grant execute on function public.is_platform_admin()          to authenticated, service_role;
grant execute on function public.user_can_access_tenant(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Vault secret helpers (BYOK).
-- These MUST live in an exposed schema (public) so the service-role client can
-- call them via PostgREST RPC. They are locked down with grants: execute is
-- REVOKED from anon/authenticated and GRANTED only to service_role. Combined
-- with the service key never leaving the server (docs/02-SECURITY.md §2), only
-- trusted server code can read/write secrets.
-- ---------------------------------------------------------------------------

-- Create-or-update a named secret; returns its uuid. Store on tenants.*_secret_id.
create or replace function public.set_tenant_secret(p_name text, p_value text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then
    v_id := vault.create_secret(p_value, p_name);
  else
    perform vault.update_secret(v_id, p_value);
  end if;
  return v_id;
end;
$$;

-- Read a decrypted secret by uuid. Service-role only (see grants below).
create or replace function public.get_tenant_secret(p_secret_id uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
  from vault.decrypted_secrets ds
  where ds.id = p_secret_id;
$$;

-- Lock down execution: strip the default PUBLIC grant and any client-role access,
-- then grant to the service role only.
revoke all on function public.set_tenant_secret(text, text) from public, anon, authenticated;
revoke all on function public.get_tenant_secret(uuid)       from public, anon, authenticated;
grant execute on function public.set_tenant_secret(text, text) to service_role;
grant execute on function public.get_tenant_secret(uuid)       to service_role;

-- Ensure the decrypted view itself is not reachable by client roles.
revoke all on vault.decrypted_secrets from anon, authenticated;
