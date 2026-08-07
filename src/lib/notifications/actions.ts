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
 *
 * `tenantId` narrows an agency caller's view to one client (docs: admin
 * notification grouping). It is never trusted as the whole scoping mechanism —
 * RLS already restricts the base rows to the caller's audience, so this can only
 * ever narrow WITHIN what the caller could already see, never widen it. Ignored
 * for a tenant-scoped caller (their feed is already one tenant).
 */
export async function listNotificationsAction(limit = 20, tenantId?: string | null): Promise<Notification[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(limit);
  if (tenantId) query = query.eq('tenant_id', tenantId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapNotification);
}

/**
 * Distinct clients that have at least one AGENCY-scope notification, for the
 * admin bell's filter dropdown — deliberately not the full tenant roster, so a
 * client with zero notifications doesn't clutter the list. RLS limits this to
 * agency rows the caller can see; a tenant-scoped caller (single-tenant feed
 * already) gets an empty list back rather than erroring, since the dropdown is
 * agency-only UI.
 */
export async function listNotificationClientsAction(): Promise<{ tenantId: string; businessName: string }[]> {
  const ctx = await getCallerContext();
  if (!ctx) return [];

  // A client who belongs to SEVERAL businesses gets the same filter the agency
  // has. Their bell already mixes both businesses' notifications (RLS admits
  // every tenant they're a member of), so without this there was no way to tell
  // which business an item belonged to, let alone narrow to one — while the
  // Orders page right next to it has exactly that control. Single-business
  // members get an empty list, so the dropdown stays absent for them.
  if (!ctx.isPlatformAdmin) {
    if (ctx.memberships.length < 2) return [];
    const supabase = await createSupabaseServerClient();
    const { data: tenants, error } = await supabase
      .from('tenants')
      .select('id, business_name')
      .in(
        'id',
        ctx.memberships.map((m) => m.tenantId),
      );
    if (error) throw new Error(error.message);
    return (tenants ?? [])
      .map((t) => ({ tenantId: t.id, businessName: t.business_name }))
      .sort((a, b) => a.businessName.localeCompare(b.businessName));
  }

  const supabase = await createSupabaseServerClient();
  const { data: rows, error } = await supabase
    .from('notifications')
    .select('tenant_id')
    .eq('scope', 'agency')
    .not('tenant_id', 'is', null);
  if (error) throw new Error(error.message);

  const tenantIds = [...new Set((rows ?? []).map((r) => r.tenant_id!))];
  if (tenantIds.length === 0) return [];

  const { data: tenants, error: tenantsError } = await supabase
    .from('tenants')
    .select('id, business_name')
    .in('id', tenantIds);
  if (tenantsError) throw new Error(tenantsError.message);

  return (tenants ?? [])
    .map((t) => ({ tenantId: t.id, businessName: t.business_name }))
    .sort((a, b) => a.businessName.localeCompare(b.businessName));
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

/**
 * `filterTenantId` scopes "mark all read" to one client when the admin bell's
 * dropdown is filtered (docs: admin notification grouping) — without it, an
 * admin viewing ONE client's feed but clicking "mark all read" would silently
 * mark every other client's unread notifications read too, a mismatch between
 * what's shown and what's affected. Ignored for a tenant-scoped caller (already
 * scoped to their own tenant_id via `audience` below).
 */
export async function markAllNotificationsReadAction(filterTenantId?: string | null): Promise<void> {
  const audience = await resolveAudience();
  if (!audience) return;

  const client = createServiceClient();
  let query = client
    .from('notifications')
    .update({ is_read: true })
    .eq('scope', audience.scope)
    .eq('is_read', false);
  if (audience.scope === 'tenant') query = query.eq('tenant_id', audience.tenantId!);
  else if (filterTenantId) query = query.eq('tenant_id', filterTenantId);

  const { error } = await query;
  if (error) throw new Error(error.message);
}
