'use server';

import { revalidatePath } from 'next/cache';
import { getCallerContext } from '@/lib/auth/context';
import { createServiceClient } from '@/lib/supabase/service';
import { env } from '@/lib/env';
import type { Database } from '@/types/database';
import type { InviteClientState } from './invite-state';

/**
 * Admin-only client login provisioning (docs/13-CLIENT-DASHBOARD-TENANT-ACCESS.md §9).
 * Deliberately minimal — no invite-acceptance pages, resend/revoke, or seat
 * management; a mis-linked tenant_id here is a direct cross-tenant leak, so
 * this is the one blessed path for creating a user_tenants row.
 */

const ROLE_VALUES = ['tenant_admin', 'tenant_agent'] as const;

export async function inviteClientLoginAction(
  tenantId: string,
  _prev: InviteClientState,
  formData: FormData,
): Promise<InviteClientState> {
  const ctx = await getCallerContext();
  if (!ctx?.isPlatformAdmin) {
    return { error: 'Forbidden.', success: false };
  }

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!email) return { error: 'Email is required.', success: false };

  const roleRaw = String(formData.get('role') ?? 'tenant_admin');
  const role = (
    (ROLE_VALUES as readonly string[]).includes(roleRaw) ? roleRaw : 'tenant_admin'
  ) as Database['public']['Enums']['member_role'];

  const svc = createServiceClient();

  // A client may already have a login (e.g. staff added to a second tenant) —
  // look up by profiles.email (populated by the on_auth_user_created trigger)
  // before inviting, since inviteUserByEmail errors on an existing address.
  const { data: existing } = await svc.from('profiles').select('id').eq('email', email).maybeSingle();

  let userId = existing?.id ?? null;

  if (!userId) {
    const { data: invited, error: inviteError } = await svc.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/dashboard`,
    });
    if (inviteError || !invited.user) {
      return { error: inviteError?.message ?? 'Invite failed.', success: false };
    }
    userId = invited.user.id;
  }

  const { error: linkError } = await svc
    .from('user_tenants')
    .upsert({ user_id: userId, tenant_id: tenantId, role }, { onConflict: 'user_id,tenant_id' });

  if (linkError) {
    return { error: linkError.message, success: false };
  }

  revalidatePath('/admin/clients');
  return { error: null, success: true };
}
