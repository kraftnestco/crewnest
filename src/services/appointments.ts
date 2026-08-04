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

/**
 * Resolve a customer's plain-language day ("thursday", "tomorrow", "4 Aug",
 * "2026-08-07") to a tenant-local calendar date, or null if it can't be read
 * confidently.
 *
 * Deliberately narrow: a wrong guess books someone on the wrong day, which is
 * far worse than asking them to say it again. Anything ambiguous returns null
 * and the tool asks the customer to clarify.
 */
export function resolveDayHint(hint: string, timezone: string | null, now: Date = new Date()): string | null {
  const tz = timezone || 'UTC';
  const raw = hint.trim().toLowerCase();
  if (!raw) return null;

  const localDate = (d: Date): string => {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(d);
    const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
    return `${g('year')}-${g('month')}-${g('day')}`;
  };
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

  // Explicit ISO date wins outright.
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (iso) return iso[1];

  if (/\btoday\b|\btonight\b/.test(raw)) return localDate(now);
  if (/\btomorrow\b|\btmrw\b|\bkal\b/.test(raw)) return localDate(addDays(now, 1));
  if (/day after tomorrow/.test(raw)) return localDate(addDays(now, 2));

  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const named = DAYS.findIndex((d) => raw.includes(d) || raw.includes(d.slice(0, 3)));
  if (named >= 0) {
    const wantNextWeek = /\bnext\b/.test(raw);
    for (let i = 0; i <= 14; i++) {
      const cand = addDays(now, i);
      const dow = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(cand).toLowerCase();
      if (dow !== DAYS[named]) continue;
      // "Tuesday" said ON a Tuesday means TODAY. An earlier version skipped
      // i === 0 on the theory that today's slots would be gone — but that sent
      // a customer saying "tuesday" at 1pm, with slots running to 11:30pm, to
      // the following Tuesday a week away. Whether today still has capacity is
      // the slot generator's job (it already applies lead time); resolving the
      // date must not pre-empt it. Only "next tuesday" skips ahead.
      return localDate(wantNextWeek ? addDays(cand, 7) : cand);
    }
  }

  return null;
}

/** Every bookable slot on ONE tenant-local calendar date (YYYY-MM-DD). */
export async function getSlotsForDay(tenant: Tenant, day: string): Promise<Slot[]> {
  if (!tenant.bookingEnabled) return [];
  // Ask for a wide window, then keep only the requested day. The slot generator
  // already handles hours, closures, lead time and existing bookings; filtering
  // its output keeps one source of truth for what "available" means.
  const slots = await getAvailableSlots(tenant, 500, new Date());
  const tz = tenant.timezone || 'UTC';
  return slots.filter((s) => {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(s.startsAt);
    const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
    return `${g('year')}-${g('month')}-${g('day')}` === day;
  });
}
