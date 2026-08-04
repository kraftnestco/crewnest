import { createSupabaseServerClient } from '@/lib/supabase/server';
import { MAX_APPOINTMENT_LOOKBACK_MINUTES, isUnfinished } from '@/lib/appointmentWindow';
import { AppointmentsView } from './appointments-view';

/** Agency-wide appointments (docs/24 §5). RLS scopes the rows; the client filter narrows within them. */
export default async function AdminAppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { tenant: tenantParam } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const nowDate = new Date();
  const lookbackIso = new Date(nowDate.getTime() - MAX_APPOINTMENT_LOOKBACK_MINUTES * 60_000).toISOString();

  const { data: tenants } = await supabase.from('tenants').select('id, business_name, timezone');

  // An unrecognised ?tenant= falls back to "all clients" rather than silently
  // returning nothing with no explanation.
  const initialTenantId = tenantParam && tenants?.some((t) => t.id === tenantParam) ? tenantParam : null;

  let query = supabase
    .from('appointments')
    .select('*')
    .gte('starts_at', lookbackIso)
    .eq('status', 'booked')
    .order('starts_at', { ascending: true })
    .limit(25);
  if (initialTenantId) query = query.eq('tenant_id', initialTenantId);

  const { data: rows } = await query;
  // The query's lookback is deliberately generous; this is the exact cut.
  const appointments = (rows ?? []).filter((a) => isUnfinished(a, nowDate));

  const tenantTimezones = Object.fromEntries((tenants ?? []).map((t) => [t.id, t.timezone]));

  return (
    <AppointmentsView
      initialAppointments={appointments ?? []}
      tenants={(tenants ?? []).map((t) => ({ id: t.id, business_name: t.business_name }))}
      tenantTimezones={tenantTimezones}
      initialTenantId={initialTenantId}
    />
  );
}
