'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import * as appointmentService from '@/services/appointments';
import * as calcom from '@/services/calcom';
import type { Database } from '@/types/database';
import type { AppointmentStatus } from '@/types/domain';
import { MAX_APPOINTMENT_LOOKBACK_MINUTES, isUnfinished } from '@/lib/appointmentWindow';
import { log } from '@/lib/log';

/**
 * Appointment dashboard actions (docs/24 §5).
 *
 * Same read-as-access-check → service-role-write pattern as the order actions:
 * `appointments` has no authenticated write policy (migration 0042), so the
 * RLS-authenticated SELECT below is what proves the caller may touch this row,
 * and the write then goes through the service client.
 */

export type AppointmentRow = Database['public']['Tables']['appointments']['Row'];

const PAGE_SIZE = 25;

export interface GetAppointmentsPageInput {
  /** starts_at cursor — fetch appointments strictly older than this. Omit for the first page. */
  before?: string | null;
  status?: AppointmentStatus | 'all';
  /** Agency-only client filter. Narrows an already-RLS-visible set; never widens it. */
  tenantId?: string | null;
  /** Upcoming-first (ascending) vs history (descending). */
  upcomingOnly?: boolean;
}

export interface GetAppointmentsPageResult {
  appointments: AppointmentRow[];
  hasMore: boolean;
}

export async function getAppointmentsPageAction(
  input: GetAppointmentsPageInput,
): Promise<GetAppointmentsPageResult> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from('appointments').select('*').limit(PAGE_SIZE);

  if (input.upcomingOnly) {
    // Fetch from a generous lookback, then cut precisely below — an
    // in-progress appointment stays in Upcoming, a finished one does not.
    query = query
      .gte('starts_at', new Date(Date.now() - MAX_APPOINTMENT_LOOKBACK_MINUTES * 60_000).toISOString())
      .order('starts_at', { ascending: true });
    if (input.before) query = query.gt('starts_at', input.before);
  } else {
    query = query.order('starts_at', { ascending: false });
    if (input.before) query = query.lt('starts_at', input.before);
  }

  if (input.status && input.status !== 'all') query = query.eq('status', input.status);
  if (input.tenantId) query = query.eq('tenant_id', input.tenantId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const filtered = input.upcomingOnly ? rows.filter((a) => isUnfinished(a)) : rows;
  // hasMore reflects the PAGE the DB returned, not the filtered count, so
  // pagination still advances when a page is mostly finished appointments.
  return { appointments: filtered, hasMore: rows.length === PAGE_SIZE };
}

async function loadAsAccessCheck(appointmentId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('appointments')
    .select('id, tenant_id, status, calcom_booking_uid, appointment_number')
    .eq('id', appointmentId)
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Appointment not found.');
  return data;
}

/** Staff-side cancellation. Frees the slot, and tidies up Cal.com when there is a booking there. */
export async function cancelAppointmentAction(appointmentId: string): Promise<void> {
  const appointment = await loadAsAccessCheck(appointmentId);
  if (appointment.status !== 'booked') {
    throw new Error('Only a booked appointment can be cancelled.');
  }

  // CrewNest-side is the source of truth and goes first — it's what releases
  // the slot via the partial unique index (migration 0042).
  await appointmentService.setStatus(appointmentId, 'cancelled');

  // Best-effort: a stale Cal.com entry is untidy but must never block this.
  if (appointment.calcom_booking_uid) {
    const ok = await calcom.cancelBooking(appointment.calcom_booking_uid, 'Cancelled by the business');
    if (!ok) {
      log.warn('[appointments] Cal.com cancel failed — CrewNest cancellation stands', { appointmentId });
    }
  }

  revalidatePath('/admin/appointments');
  revalidatePath('/dashboard/appointments');
}

/** Mark an appointment as completed or a no-show, after the fact. */
export async function setAppointmentOutcomeAction(
  appointmentId: string,
  outcome: 'completed' | 'no_show',
): Promise<void> {
  const appointment = await loadAsAccessCheck(appointmentId);
  if (appointment.status !== 'booked') {
    throw new Error('Only a booked appointment can be marked completed or no-show.');
  }

  await appointmentService.setStatus(appointmentId, outcome);
  revalidatePath('/admin/appointments');
  revalidatePath('/dashboard/appointments');
}
