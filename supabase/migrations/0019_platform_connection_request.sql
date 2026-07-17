-- 0019_platform_connection_request.sql
-- Lets a tenant_admin flag which channels (WhatsApp / Messenger / Instagram /
-- Web widget) they'd like connected, plus a free-text note for the agency —
-- without collecting any secrets client-side (CLAUDE.md locked decision #2:
-- "zero secrets on the client"). Additive only, no new RLS: these columns are
-- covered by the existing tenants_update_self policy (0018) because the sole
-- writer, requestPlatformSetupAction (src/app/dashboard/actions.ts), only ever
-- sets these three columns for the caller's own tenant.

alter table public.tenants
  add column if not exists requested_platforms text[] not null default '{}',
  add column if not exists platform_setup_notes text,
  add column if not exists platform_setup_requested_at timestamptz;
