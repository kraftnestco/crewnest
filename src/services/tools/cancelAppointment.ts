import 'server-only';
import { z } from 'zod';
import * as appointments from '@/services/appointments';
import * as calcom from '@/services/calcom';
import type { ToolContext, ToolExecutor } from './registry';

/**
 * cancel_appointment — cancels a booking and frees the slot (docs/24 §4.1).
 *
 * Rescheduling is deliberately not a separate tool: cancel-then-book is the
 * same two calls the model can already make, and a dedicated reschedule would
 * need its own conflict-and-rollback handling for no new capability.
 */

const argsSchema = z.object({
  appointment_number: z.number().int().positive(),
});

export const cancelAppointmentTool: ToolExecutor = {
  def: {
    name: 'cancel_appointment',
    description:
      "Cancel a booked appointment by its number (the '#N' the customer was given). Use this when the customer wants to cancel or reschedule — for a reschedule, cancel first, then call check_availability.",
    parameters: {
      type: 'object',
      properties: {
        appointment_number: { type: 'number', description: "The appointment number, e.g. 7 for '#7'." },
      },
      required: ['appointment_number'],
    },
  },
  argsSchema,
  async execute(args: unknown, ctx: ToolContext) {
    const { appointment_number } = args as z.infer<typeof argsSchema>;

    // Looked up BY NUMBER, scoped to this tenant — the model can never supply a
    // uuid or reach another tenant's booking.
    const appointment = await appointments.getByNumber(ctx.tenant.id, appointment_number);
    if (!appointment) {
      return { ok: false, message: `No appointment #${appointment_number} was found for this business.` };
    }

    if (appointment.status === 'cancelled') {
      return { ok: true, message: `Appointment #${appointment_number} was already cancelled.` };
    }
    if (appointment.status !== 'booked') {
      return { ok: false, message: `Appointment #${appointment_number} can no longer be cancelled.` };
    }

    // ClerkNest-side cancellation is the source of truth and happens first — it
    // is what frees the slot via the partial unique index.
    await appointments.setStatus(appointment.id, 'cancelled');

    // Best-effort tidy-up of the Cal.com side. A failure leaves a stale entry
    // there, which must never block the customer's cancellation.
    if (appointment.calcomBookingUid) {
      await calcom.cancelBooking(appointment.calcomBookingUid);
    }

    return {
      ok: true,
      message: `Appointment #${appointment_number} is cancelled. Confirm to the customer and offer to rebook if they'd like.`,
    };
  },
};
