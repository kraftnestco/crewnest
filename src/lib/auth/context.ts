import 'server-only';
import { cache } from 'react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

export type MemberRole = Database['public']['Enums']['member_role'];
export interface Membership {
  tenantId: string;
  role: MemberRole;
}
export interface CallerContext {
  userId: string;
  email: string | null;
  fullName: string | null;
  isPlatformAdmin: boolean;
  memberships: Membership[]; // [] for a pure platform admin or an unassigned user
}

/** Request-scoped (React cache): resolves the caller from the auth cookie only. */
export const getCallerContext = cache(async (): Promise<CallerContext | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser(); // getUser, not getSession — verified server-side
  if (!user) return null;

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from('profiles').select('email, full_name, is_platform_admin').eq('id', user.id).single(),
    // user_tenants_select RLS already returns only the caller's own rows.
    supabase.from('user_tenants').select('tenant_id, role').eq('user_id', user.id),
  ]);

  return {
    userId: user.id,
    email: profile?.email ?? user.email ?? null,
    fullName: profile?.full_name ?? null,
    isPlatformAdmin: profile?.is_platform_admin ?? false,
    memberships: (memberships ?? []).map((m) => ({ tenantId: m.tenant_id, role: m.role })),
  };
});

/** Server-side scoping authority. NEVER derive the active tenant from a client-supplied value. */
export function assertTenantAccess(ctx: CallerContext, tenantId: string): void {
  const ok = ctx.isPlatformAdmin || ctx.memberships.some((m) => m.tenantId === tenantId);
  if (!ok) throw new Error('Forbidden: tenant not accessible.');
}

/**
 * Picks the active tenant for a multi-membership caller. The cookie is a
 * convenience only — always re-validated against ctx.memberships, never
 * trusted as the authority. Caller must ensure ctx has >=1 membership.
 */
export function resolveActiveTenant(ctx: CallerContext, cookieTenantId: string | undefined): string | undefined {
  if (cookieTenantId && ctx.memberships.some((m) => m.tenantId === cookieTenantId)) return cookieTenantId;
  return ctx.memberships[0]?.tenantId;
}
