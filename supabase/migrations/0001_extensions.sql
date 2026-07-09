-- 0001_extensions.sql
-- Base extensions. Run first.
-- NOTE: On Supabase, enable "Vault" from Dashboard > Database > Extensions if the guarded
-- create below does not succeed on your plan. pgmq (Phase 3) lives in 0008.

-- gen_random_uuid(), digest(), hmac() etc.
create extension if not exists pgcrypto;

-- Supabase Vault (secrets manager). Installs into the `vault` schema.
-- Safe if already enabled.
do $$
begin
  create extension if not exists supabase_vault;
exception
  when others then
    raise notice 'supabase_vault not created here (likely already enabled or managed by Supabase): %', sqlerrm;
end
$$;
