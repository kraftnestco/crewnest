-- 0002_enums.sql
-- Closed-set enums. Guarded so re-runs don't error.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'platform') then
    create type platform as enum ('whatsapp','facebook','instagram','web','voice');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'message_role') then
    -- 'tool' is reserved for Phase 2 tool-calling; unused in Phase 1.
    create type message_role as enum ('system','user','assistant','tool');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'member_role') then
    create type member_role as enum ('platform_admin','tenant_admin','tenant_agent');
  end if;
end $$;
