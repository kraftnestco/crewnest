'use server';

import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getCallerContext, resolveActiveTenant } from '@/lib/auth/context';
import { mapNotification } from '@/services/notifications';
import type { Notification } from '@/types/domain';

/** Derives the caller's own notification audience server-side — never client-supplied (docs/14 §4.3). */
async function resolveAudience(): Promise<{ scope: 'agency' | 'tenant'; tenantId: string | null } | null> {
  const ctx = await getCallerContext();
  if (!ctx) return null;
  if (ctx.isPlatformAdmin) return { scope: 'agency', tenantId: null };

  const cookieStore = await cookies();
  const activeTenantId = resolveActiveTenant(ctx, cookieStore.get('cn_active_tenant')?.value);
  if (!activeTenantId) return null;
  return { scope: 'tenant', tenantId: activeTenantId };
}

/**
 * RLS server client — scoped automatically to the caller's audience (agency rows
 * for a platform admin, this tenant's rows for a client). See migration 0023.
 */
export async function listNotificationsAction(limit = 20): Promise<Notification[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapNotification);
}

export async function getUnreadCountAction(): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('is_read', false);

  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * Mutations write via the service-role client (no authenticated write policy
 * exists — migration 0023), but the audience filter is derived server-side from
 * the caller's own context, so a client can only ever mark its own audience's
 * rows read.
 */
export async function markNotificationReadAction(id: string): Promise<void> {
  const audience = await resolveAudience();
  if (!audience) return;

  const client = createServiceClient();
  let query = client.from('notifications').update({ is_read: true }).eq('id', id).eq('scope', audience.scope);
  if (audience.scope === 'tenant') query = query.eq('tenant_id', audience.tenantId!);

  const { error } = await query;
  if (error) throw new Error(error.message);
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const audience = await resolveAudience();
  if (!audience) return;

  const client = createServiceClient();
  let query = client
    .from('notifications')
    .update({ is_read: true })
    .eq('scope', audience.scope)
    .eq('is_read', false);
  if (audience.scope === 'tenant') query = query.eq('tenant_id', audience.tenantId!);

  const { error } = await query;
  if (error) throw new Error(error.message);
}
