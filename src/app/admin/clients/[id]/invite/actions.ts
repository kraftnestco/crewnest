'use server';

import { revalidatePath } from 'next/cache';
import { getCallerContext } from '@/lib/auth/context';
import { createServiceClient } from '@/lib/supabase/service';
import type { Database } from '@/types/database';
import type { InviteClientState } from './invite-state';

/**
 * Admin-only client login provisioning (docs/13-CLIENT-DASHBOARD-TENANT-ACCESS.md §9).
 * No revoke or seat management — a mis-linked tenant_id here is a direct
 * cross-tenant leak, so this is the one blessed path for creating a
 * user_tenants row. Stale-invite resend (below) is the one deliberate
 * exception to "minimal": without it, a client whose one-time code expired
 * before they used it would be stuck forever, since inviteUserByEmail
 * refuses to resend to an address that already has an auth.users row.
 */

const ROLE_VALUES = ['tenant_admin', 'tenant_agent'] as const;

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
    (ROLE_VALUES as readonly string[]).includes(roleRaw) ? roleRaw : 'tenant_admin'
  ) as Database['public']['Enums']['member_role'];

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
  // resend — the admin isn't the right party to be pushing password-reset
  // emails at a client's inbox on their behalf. If they've lost access to
  // their password, "Forgot password" on the login page is the self-serve
  // path for that.

  const { error: linkError } = await svc
    .from('user_tenants')
    .upsert({ user_id: userId, tenant_id: tenantId, role }, { onConflict: 'user_id,tenant_id' });

  if (linkError) {
    return { error: linkError.message, success: false, alreadyRegistered: alreadyActive, resent };
  }

  revalidatePath('/admin/clients');
  return { error: null, success: true, alreadyRegistered: alreadyActive, resent };
}
