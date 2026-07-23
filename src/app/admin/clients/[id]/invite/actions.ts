'use server';

import { revalidatePath } from 'next/cache';
import { getCallerContext } from '@/lib/auth/context';
import { inviteMember, MEMBER_ROLE_VALUES, type AssignableMemberRole } from '@/services/teamMembers';
import type { InviteClientState } from './invite-state';

/**
 * Admin-only client login provisioning (docs/13-CLIENT-DASHBOARD-TENANT-ACCESS.md §9).
 * Core invite-or-link logic lives in services/teamMembers.ts, shared with the
 * tenant self-service team action (dashboard/team/actions.ts, docs/18 §5) —
 * this wrapper only adds the platform_admin gate and the admin-tree redirect.
 */

export async function inviteClientLoginAction(
  tenantId: string,
  _prev: InviteClientState,
  formData: FormData,
): Promise<InviteClientState> {
  const ctx = await getCallerContext();
  if (!ctx?.isPlatformAdmin) {
    return { error: 'Forbidden.', success: false, alreadyRegistered: false, resent: false };
  }

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!email) return { error: 'Email is required.', success: false, alreadyRegistered: false, resent: false };

  const roleRaw = String(formData.get('role') ?? 'tenant_admin');
  const role = (
    (MEMBER_ROLE_VALUES as readonly string[]).includes(roleRaw) ? roleRaw : 'tenant_admin'
  ) as AssignableMemberRole;

  const result = await inviteMember(tenantId, email, role);
  if (result.success) revalidatePath('/admin/clients');
  return result;
}
