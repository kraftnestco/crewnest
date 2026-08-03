import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { computeAvailableSlots, type BusyInterval, type Slot } from './hours';
import type { Database } from '@/types/database';
import type { Appointment, AppointmentStatus, Platform, Tenant } from '@/types/domain';

/**
 * Appointment persistence + availability (docs/24-APPOINTMENTS.md).
 *
 * Service-role only, matching `orders`: the table has no authenticated INSERT/
 * UPDATE policy (migration 0042), so every write goes through here. The
 * RLS-authenticated read in a page/action is the access check, same
 * read-as-access-check pattern the order actions use.
 */

type AppointmentRow = Database['public']['Tables']['appointments']['Row'];

export function mapAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sessionId: row.session_id,
    appointmentNumber: row.appointment_number,
    startsAt: row.starts_at,
    durationMinutes: row.duration_minutes,
    status: row.status as AppointmentStatus,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    notes: row.notes,
    serviceName: row.service_name,
    meetingUrl: row.meeting_url,
    locationText: row.location_text,
    calcomBookingUid: row.calcom_booking_uid,
    platform: row.platform,
    externalUserId: row.external_user_id,
    createdAt: row.created_at,
  };
}

/** Booked appointments in a window — the `busy` input to slot computation. */
export async function loadBusy(tenantId: string, from: Date, to: Date): Promise<BusyInterval[]> {
  const client = createServiceClient();
  const { data, error } = await client
    .from('appointments')
    .select('starts_at, duration_minutes')
    .eq('tenant_id', tenantId)
    .eq('status', 'booked')
    .gte('starts_at', from.toISOString())
    .lte('starts_at', to.toISOString());

  if (error) throw error;

  return (data ?? []).map((r) => {
    const startsAt = new Date(r.starts_at);
    return { startsAt, endsAt: new Date(startsAt.getTime() + r.duration_minutes * 60_000) };
  });
}

/**
 * Bookable slots for a tenant, honouring its hours, closures, lead time and
 * existing bookings. Returns [] when booking isn't configured — callers treat
 * that as "no availability to offer", never as an error.
 */
export async function getAvailableSlots(tenant: Tenant, limit = 8, from: Date = new Date()): Promise<Slot[]> {
  if (!tenant.bookingEnabled) return [];

  const horizon = new Date(from.getTime() + tenant.bookingMaxDaysAhead * 24 * 60 * 60_000);
  const busy = await loadBusy(tenant.id, from, horizon);

  return computeAvailableSlots({
    businessHours: tenant.businessHours,
    timezone: tenant.timezone,
    durationMinutes: tenant.bookingDurationMinutes,
    leadTimeMinutes: tenant.bookingLeadTimeMinutes,
    maxDaysAhead: tenant.bookingMaxDaysAhead,
    busy,
    from,
    limit,
  });
}

/** True if `startsAt` is still genuinely bookable — re-checked at booking time, never trusted from the model. */
export async function isSlotAvailable(tenant: Tenant, startsAt: Date): Promise<boolean> {
  const slots = await getAvailableSlots(tenant, 500, new Date());
  return slots.some((s) => s.startsAt.getTime() === startsAt.getTime());
}

export interface BookInput {
  tenant: Tenant;
  sessionId: string | null;
  startsAt: Date;
  customerName?: string | null;
  customerPhone?: string | null;
  serviceName?: string | null;
  notes?: string | null;
  platform?: Platform | null;
  externalUserId?: string | null;
  meetingUrl?: string | null;
  locationText?: string | null;
}

/**
 * Book a slot. Returns null when the slot was taken by a concurrent booking —
 * NOT an error. The partial unique index (migration 0042) is the real guard;
 * `book_appointment_atomic` catches the 23505 and returns null so the caller
 * can say "that time just went" instead of surfacing a database failure.
 */
export async function book(input: BookInput): Promise<Appointment | null> {
  const client = createServiceClient();
  const { data, error } = await client.rpc('book_appointment_atomic', {
    p_tenant_id: input.tenant.id,
    p_session_id: input.sessionId,
    p_starts_at: input.startsAt.toISOString(),
    p_duration_minutes: input.tenant.bookingDurationMinutes,
    p_customer_name: input.customerName ?? null,
    p_customer_phone: input.customerPhone ?? null,
    p_service_name: input.serviceName ?? null,
    p_notes: input.notes ?? null,
    p_platform: input.platform ?? null,
    p_external_user_id: input.externalUserId ?? null,
    p_meeting_url: input.meetingUrl ?? null,
    p_location_text: input.locationText ?? null,
  });

  if (error) throw error;
  if (!data) return null; // slot taken — expected, not a failure.
  return mapAppointment(data as unknown as AppointmentRow);
}

/** Attach the meeting link after the fact — path B mints it post-insert (docs/24 §4.3). */
export async function setMeetingDetails(
  appointmentId: string,
  meetingUrl: string,
  calcomBookingUid: string | null,
): Promise<void> {
  const client = createServiceClient();
  const { error } = await client
    .from('appointments')
    .update({ meeting_url: meetingUrl, calcom_booking_uid: calcomBookingUid })
    .eq('id', appointmentId);
  if (error) throw error;
}

/** Look up by the CUSTOMER-facing number, scoped to the tenant — never by uuid from a model. */
export async function getByNumber(tenantId: string, appointmentNumber: number): Promise<Appointment | null> {
  const client = createServiceClient();
  const { data, error } = await client
    .from('appointments')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('appointment_number', appointmentNumber)
    .maybeSingle();
  if (error) throw error;
  return data ? mapAppointment(data) : null;
}

export async function setStatus(appointmentId: string, status: AppointmentStatus): Promise<void> {
  const client = createServiceClient();
  const { error } = await client.from('appointments').update({ status }).eq('id', appointmentId);
  if (error) throw error;
}

/** Upcoming booked appointments for a session's customer — lets the AI answer "when is my appointment?". */
export async function listUpcomingForSession(sessionId: string, limit = 5): Promise<Appointment[]> {
  const client = createServiceClient();
  const { data, error } = await client
    .from('appointments')
    .select('*')
    .eq('session_id', sessionId)
    .eq('status', 'booked')
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(mapAppointment);
}
