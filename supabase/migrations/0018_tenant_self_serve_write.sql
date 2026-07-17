-- 0018_tenant_self_serve_write.sql
-- Phase-2 client dashboard: let a tenant_admin update THEIR OWN tenant's
-- business config (system prompt, catalogue, orders / custom-order / payment
-- toggles) from the reused intake wizard = the client's "My Business" screen.
-- See docs/13-CLIENT-DASHBOARD-TENANT-ACCESS.md §7 and docs/10 §9.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- OPTIONAL / SCOPED. This migration is NOT required for the inbox + orders MVP:
-- those paths are already tenant-safe under 0006 RLS (chat_sessions/chat_messages
-- writes admit members) + read-gated service-role writes on `orders`. Apply this
-- ONLY when the self-serve "My Business" editing screen ships, and apply it
-- TOGETHER WITH the app-layer guards in docs/13 §3.3 + §3.4 (see the warning
-- below) — never before them.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Why it is needed: `tenants_write` (0006) is `is_platform_admin()` ONLY, so a
-- tenant_admin's UPDATE on their own tenant row matches 0 rows and returns NO
-- error — updateIntakeAction (src/app/admin/clients/[id]/intake/actions.ts)
-- silently no-ops. This adds a tenant_admin UPDATE path. Postgres OR-combines
-- permissive policies for the same command, so UPDATE becomes allowed when
-- `is_platform_admin()` (existing tenants_write) OR the caller is a tenant_admin
-- member of the row (this policy). No tenant INSERT/DELETE is granted.
--
-- ⚠️ ROW-LEVEL, NOT COLUMN-LEVEL. This lets a tenant_admin UPDATE ANY column on
-- their own tenant row (incl. meta ids, Vault secret refs, is_active, widget
-- keys). The design stays safe ONLY because:
--   1. The sole tenant-facing writer, updateIntakeAction, sets business-config
--      columns only; the tenant UI never exposes the all-column agency writers.
--   2. createTenantAction + updateTenantAction (all columns) are hard-locked to
--      platform admins IN-BODY (docs/13 §3.4) — a Next.js Server Action is
--      invokable by anyone who can reach its id, so RLS alone is not enough once
--      this policy exists.
-- If a tenant must ever edit sensitive columns, replace this policy with a
-- SECURITY DEFINER whitelist RPC instead (docs/13 §7.3).
--
-- Restricted to role = 'tenant_admin' (member_role enum, 0002); a 'tenant_agent'
-- gets inbox + orders only and canNOT edit business settings.

drop policy if exists tenants_update_self on public.tenants;
create policy tenants_update_self on public.tenants
  for update to authenticated
  using (
    exists (
      select 1
      from public.user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = public.tenants.id
        and ut.role = 'tenant_admin'
    )
  )
  with check (
    exists (
      select 1
      from public.user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = public.tenants.id
        and ut.role = 'tenant_admin'
    )
  );
