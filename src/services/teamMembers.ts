import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import type { Database } from '@/types/database';

/**
 * Tenant team membership (docs/18 §5, Stage V) + the agency's own client-login
 * invite (admin/clients/[id]/invite/actions.ts). `user_tenants` and `profiles`
 * RLS is self-row-only (migration 0006) — narrower than the general
 * `user_can_access_tenant` tenant-data policy — so every function here uses the
 * SERVICE client and trusts the caller to have already authorized the request
 * (platform_admin for the agency flow, or "tenant_admin of this tenant" for the
 * dashboard flow).
 */

/** Roles a tenant_admin or agency staff may assign via invite/change-role — never `platform_admin` (agency-only, docs/18 §5 guardrail 2). */
export const MEMBER_ROLE_VALUES = ['tenant_admin', 'tenant_agent'] as const;
export type AssignableMemberRole = (typeof MEMBER_ROLE_VALUES)[number];

export interface InviteMemberResult {
  error: string | null;
  success: boolean;
  alreadyRegistered: boolean;
  resent: boolean;
}

/**
 * Invite-or-link a user to a tenant. Shared core of the agency invite action
 * and the tenant self-service team action (docs/18 §5: "The tenant flow
 * reuses this exact action, scoped to the caller's tenant"). No revoke/seat
 * management — a mis-linked tenant_id here is a direct cross-tenant leak, so
 * callers must bind `tenantId` server-side, never from client input.
 */
export async function inviteMember(
  tenantId: string,
  email: string,
  role: AssignableMemberRole,
): Promise<InviteMemberResult> {
  const svc = createServiceClient();

  // A client may already have a login (e.g. staff added to a second tenant, or
  // they signed up under this email some other way) — look up by profiles.email
  // (populated by the on_auth_user_created trigger) before inviting, since
  // inviteUserByEmail errors on an existing address.
  const { data: existing } = await svc.from('profiles').select('id').eq('email', email).maybeSingle();

  let userId = existing?.id ?? null;
  let alreadyActive = false;
  let resent = false;

  if (userId) {
    const { data: authUser } = await svc.auth.admin.getUserById(userId);
    const neverConfirmed = !authUser.user?.confirmed_at;

    // A pending invite that was never accepted has, by construction, never
    // been linked to any tenant yet — check directly rather than trusting
    // "unconfirmed" alone, since deleting the auth user cascades to profiles
    // and user_tenants (0003_tables.sql) and would silently strip any real
    // membership a since-confirmed account holds.
    let hasTenantLinks = true;
    if (neverConfirmed) {
      const { count } = await svc
        .from('user_tenants')
        .select('user_id', { count: 'exact', head: true })
        .eq('user_id', userId);
      hasTenantLinks = (count ?? 0) > 0;
    }

    if (neverConfirmed && !hasTenantLinks) {
      await svc.auth.admin.deleteUser(userId);
      userId = null;
      resent = true;
    } else {
      alreadyActive = true;
    }
  }

  if (!userId) {
    // No redirectTo: the "Invite user" email template sends a typed code
    // ({{ .Token }}), not a clickable link, so there's no link-back page to
    // point at (see verify-code-form.tsx).
    const { data: invited, error: inviteError } = await svc.auth.admin.inviteUserByEmail(email);
    if (inviteError || !invited.user) {
      return { error: inviteError?.message ?? 'Invite failed.', success: false, alreadyRegistered: false, resent: false };
    }
    userId = invited.user.id;
  }
  // Already-active profile: this is just a link-to-tenant action, not a
  // resend — the caller isn't the right party to be pushing password-reset
  // emails at someone's inbox on their behalf. "Forgot password" on the login
  // page is the self-serve path for that.

  const { error: linkError } = await svc
    .from('user_tenants')
    .upsert({ user_id: userId, tenant_id: tenantId, role }, { onConflict: 'user_id,tenant_id' });

  if (linkError) {
    return { error: linkError.message, success: false, alreadyRegistered: alreadyActive, resent };
  }

  return { error: null, success: true, alreadyRegistered: alreadyActive, resent };
}

export interface TeamMember {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: Database['public']['Enums']['member_role'];
  joinedAt: string;
}

/** List a tenant's members (name, email, role, joined) — docs/18 §5. */
export async function listTeamMembers(tenantId: string): Promise<TeamMember[]> {
  const svc = createServiceClient();
  const { data: links, error: linksError } = await svc
    .from('user_tenants')
    .select('user_id, role, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });
  if (linksError) throw linksError;

  const userIds = (links ?? []).map((l) => l.user_id);
  if (userIds.length === 0) return [];

  const { data: profiles, error: profilesError } = await svc
    .from('profiles')
    .select('id, email, full_name')
    .in('id', userIds);
  if (profilesError) throw profilesError;

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  return (links ?? []).map((l) => ({
    userId: l.user_id,
    email: profileById.get(l.user_id)?.email ?? null,
    fullName: profileById.get(l.user_id)?.full_name ?? null,
    role: l.role,
    joinedAt: l.created_at,
  }));
}

/** How many `tenant_admin` members a tenant has — backs the last-admin lockout guard (docs/18 §5 guardrail 3). */
export async function countTenantAdmins(tenantId: string): Promise<number> {
  const svc = createServiceClient();
  const { count, error } = await svc
    .from('user_tenants')
    .select('user_id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('role', 'tenant_admin');
  if (error) throw error;
  return count ?? 0;
}
