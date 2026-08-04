import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCallerContext, resolveActiveTenant } from '@/lib/auth/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { MAX_APPOINTMENT_LOOKBACK_MINUTES, isUnfinished } from '@/lib/appointmentWindow';
import { AppointmentsView } from '@/app/admin/appointments/appointments-view';

/** A single business's own appointments. Same view as the agency page, tenant-scoped. */
export default async function DashboardAppointmentsPage() {
  const ctx = await getCallerContext(); // layout already gated; re-derive (React cache dedupes)
  if (!ctx) redirect('/login');

  const cookieStore = await cookies();
  const activeTenantId = resolveActiveTenant(ctx, cookieStore.get('cn_active_tenant')?.value);
  if (!activeTenantId) redirect('/dashboard');

  const supabase = await createSupabaseServerClient();
  const nowDate = new Date();
  const lookbackIso = new Date(nowDate.getTime() - MAX_APPOINTMENT_LOOKBACK_MINUTES * 60_000).toISOString();

  const [{ data: rows }, { data: memberTenants }] = await Promise.all([
    supabase
      .from('appointments')
      .select('*')
      .eq('tenant_id', activeTenantId) // explicit; RLS also enforces
      .gte('starts_at', lookbackIso)
      .eq('status', 'booked')
      .order('starts_at', { ascending: true })
      .limit(25),
    // Only the caller's own tenant(s) — never the full tenants table.
    supabase
      .from('tenants')
      .select('id, business_name, timezone')
      .in(
        'id',
        ctx.memberships.map((m) => m.tenantId),
      ),
  ]);

  const appointments = (rows ?? []).filter((a) => isUnfinished(a, nowDate));

  const tenantTimezones = Object.fromEntries((memberTenants ?? []).map((t) => [t.id, t.timezone]));

  return (
    <AppointmentsView
      initialAppointments={appointments ?? []}
      tenants={(memberTenants ?? []).map((t) => ({ id: t.id, business_name: t.business_name }))}
      tenantTimezones={tenantTimezones}
      showBusinessColumn={ctx.memberships.length > 1}
      chatBasePath="/dashboard/chat"
      initialTenantId={null}
    />
  );
}
