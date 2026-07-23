'use server';

import { revalidatePath } from 'next/cache';
import { getCallerContext, type CallerContext } from '@/lib/auth/context';
import { createServiceClient } from '@/lib/supabase/service';
import { countTenantAdmins, inviteMember, MEMBER_ROLE_VALUES, type AssignableMemberRole } from '@/services/teamMembers';
import type { InviteTeamMemberState, TeamMemberActionState } from './action-state';

/**
 * Tenant self-service team management (docs/18 §5, Stage V). `user_tenants`
 * and `profiles` RLS is self-row-only (migration 0006), so these actions use
 * the SERVICE client like the agency invite action — gated by an explicit
 * "caller is tenant_admin of THIS tenant" check instead of RLS. `tenantId` is
 * always the server-resolved active tenant from the page, never client input.
 */

async function requireTenantAdmin(tenantId: string): Promise<CallerContext | null> {
  const ctx = await getCallerContext();
  const isAdminHere = ctx?.memberships.some((m) => m.tenantId === tenantId && m.role === 'tenant_admin') ?? false;
  return isAdminHere ? ctx : null;
}

export async function inviteTeamMemberAction(
  tenantId: string,
  _prev: InviteTeamMemberState,
  formData: FormData,
): Promise<InviteTeamMemberState> {
  const ctx = await requireTenantAdmin(tenantId);
  if (!ctx) return { error: 'Forbidden.', success: false, alreadyRegistered: false, resent: false };

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!email) return { error: 'Email is required.', success: false, alreadyRegistered: false, resent: false };

  const roleRaw = String(formData.get('role') ?? 'tenant_agent');
  const role = (
    (MEMBER_ROLE_VALUES as readonly string[]).includes(roleRaw) ? roleRaw : 'tenant_agent'
  ) as AssignableMemberRole;

  const result = await inviteMember(tenantId, email, role);
  if (result.success) revalidatePath('/dashboard/team');
  return result;
}

export async function changeMemberRoleAction(
  tenantId: string,
  userId: string,
  newRoleRaw: string,
): Promise<TeamMemberActionState> {
  const ctx = await requireTenantAdmin(tenantId);
  if (!ctx) return { error: 'Forbidden.', success: false };

  if (!(MEMBER_ROLE_VALUES as readonly string[]).includes(newRoleRaw)) {
    return { error: 'Invalid role.', success: false };
  }
  const newRole = newRoleRaw as AssignableMemberRole;

  const svc = createServiceClient();
  const { data: current, error: currentError } = await svc
    .from('user_tenants')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();
  if (currentError) return { error: currentError.message, success: false };
  if (!current) return { error: 'Member not found.', success: false };
  if (current.role === 'platform_admin') return { error: "Can't manage a platform admin's role here.", success: false };

  if (current.role === 'tenant_admin' && newRole !== 'tenant_admin') {
    const adminCount = await countTenantAdmins(tenantId);
    if (adminCount <= 1) {
      return { error: "Can't demote the last admin — promote someone else first.", success: false };
    }
  }

  const { error } = await svc
    .from('user_tenants')
    .update({ role: newRole })
    .eq('tenant_id', tenantId)
    .eq('user_id', userId);
  if (error) return { error: error.message, success: false };

  revalidatePath('/dashboard/team');
  return { error: null, success: true };
}

export async function removeMemberAction(tenantId: string, userId: string): Promise<TeamMemberActionState> {
  const ctx = await requireTenantAdmin(tenantId);
  if (!ctx) return { error: 'Forbidden.', success: false };

  const svc = createServiceClient();
  const { data: current, error: currentError } = await svc
    .from('user_tenants')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();
  if (currentError) return { error: currentError.message, success: false };
  if (!current) return { error: 'Member not found.', success: false };
  if (current.role === 'platform_admin') return { error: "Can't remove a platform admin here.", success: false };

  if (current.role === 'tenant_admin') {
    const adminCount = await countTenantAdmins(tenantId);
    if (adminCount <= 1) {
      return { error: "Can't remove the last admin — promote someone else first.", success: false };
    }
  }

  const { error } = await svc.from('user_tenants').delete().eq('tenant_id', tenantId).eq('user_id', userId);
  if (error) return { error: error.message, success: false };

  revalidatePath('/dashboard/team');
  return { error: null, success: true };
}
