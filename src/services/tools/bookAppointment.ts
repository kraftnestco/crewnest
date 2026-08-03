import 'server-only';
import { z } from 'zod';
import * as appointments from '@/services/appointments';
import * as calcom from '@/services/calcom';
import { notifyBoth } from '@/services/notifications';
import type { ToolContext, ToolExecutor } from './registry';
import { log } from '@/lib/log';

/**
 * book_appointment — books a slot the customer has explicitly chosen
 * (docs/24 §4.2). The model must only call this after the customer has picked
 * a specific time from `check_availability`.
 */

const argsSchema = z.object({
  /** Echoed verbatim from check_availability's `starts_at`. */
  starts_at: z.string().min(1),
  customer_name: z.string().min(1),
  customer_phone: z.string().optional(),
  service_name: z.string().optional(),
  notes: z.string().optional(),
});

export const bookAppointmentTool: ToolExecutor = {
  def: {
    name: 'book_appointment',
    description:
      'Book an appointment at a specific time. Only call this after the customer has chosen one of the slots returned by check_availability. Pass starts_at back EXACTLY as it was given to you.',
    parameters: {
      type: 'object',
      properties: {
        starts_at: { type: 'string', description: 'The exact starts_at value from check_availability.' },
        customer_name: { type: 'string', description: "The customer's name." },
        customer_phone: { type: 'string', description: 'Phone number, if the customer gave one.' },
        service_name: { type: 'string', description: 'Which service, if the business offers several.' },
        notes: { type: 'string', description: 'Anything else relevant the customer mentioned.' },
      },
      required: ['starts_at', 'customer_name'],
    },
  },
  argsSchema,
  async execute(args: unknown, ctx: ToolContext) {
    const { starts_at, customer_name, customer_phone, service_name, notes } = args as z.infer<typeof argsSchema>;

    const startsAt = new Date(starts_at);
    if (Number.isNaN(startsAt.getTime())) {
      return { ok: false, message: "That time wasn't understood. Call check_availability again and offer fresh slots." };
    }

    // Re-validate server-side. The customer may have taken minutes to reply and
    // the slot may be gone — the model's choice is never trusted (docs/24 §4.2).
    const stillFree = await appointments.isSlotAvailable(ctx.tenant, startsAt);
    if (!stillFree) {
      return {
        ok: false,
        message: 'That time is no longer available. Call check_availability again and offer the customer fresh slots.',
      };
    }

    // Path A resolves the location up front; path B mints it after insert.
    const ownLink = ctx.tenant.bookingMode === 'own_link' ? ctx.tenant.bookingOwnLink : null;
    const isUrl = Boolean(ownLink && /^https?:\/\//i.test(ownLink));

    const appointment = await appointments.book({
      tenant: ctx.tenant,
      sessionId: ctx.session.id,
      startsAt,
      customerName: customer_name,
      customerPhone: customer_phone ?? null,
      serviceName: service_name ?? null,
      notes: notes ?? null,
      platform: ctx.session.platform,
      externalUserId: ctx.session.externalUserId,
      meetingUrl: isUrl ? ownLink : null,
      locationText: ownLink && !isUrl ? ownLink : null,
    });

    // null = a concurrent booking won this slot. Expected, not an error.
    if (!appointment) {
      return {
        ok: false,
        message: 'That time was just taken by someone else. Call check_availability again and offer fresh slots.',
      };
    }

    let meetingUrl = appointment.meetingUrl;

    // Path B: mint the link. Failure must NOT undo the booking (docs/24 §4.3) —
    // the customer has already been given a time.
    if (ctx.tenant.bookingMode === 'calcom' && calcom.isCalcomConfigured()) {
      const booking = await calcom.createBooking({
        startsAt,
        customerName: customer_name,
        timeZone: ctx.tenant.timezone ?? 'UTC',
      });
      if (booking?.meetingUrl) {
        meetingUrl = booking.meetingUrl;
        try {
          await appointments.setMeetingDetails(appointment.id, booking.meetingUrl, booking.uid);
        } catch (err) {
          log.error('[book_appointment] failed to persist meeting link', {
            appointmentId: appointment.id,
            error: err instanceof Error ? err.message : 'unknown',
          });
        }
      } else {
        log.warn('[book_appointment] booked without a meeting link — staff can attach one', {
          appointmentId: appointment.id,
        });
      }
    }

    // Best-effort owner notification, same posture as create_order.
    try {
      await notifyBoth({
        tenantId: ctx.tenant.id,
        type: 'new_order',
        entityType: 'session',
        entityId: ctx.session.id,
        agency: {
          title: 'New appointment',
          body: `${ctx.tenant.businessName} — #${appointment.appointmentNumber} with ${customer_name}`,
          link: `/admin/appointments`,
        },
        tenant: {
          title: 'New appointment booked',
          body: `#${appointment.appointmentNumber} with ${customer_name}`,
          link: `/dashboard/appointments`,
        },
      });
    } catch (err) {
      log.error('[book_appointment] notify failed', { error: err instanceof Error ? err.message : 'unknown' });
    }

    return {
      ok: true,
      appointment_number: appointment.appointmentNumber,
      meeting_url: meetingUrl,
      location: appointment.locationText,
      message: meetingUrl
        ? 'Confirm the booking to the customer, quoting the appointment number and the meeting link.'
        : 'Confirm the booking and the time to the customer. Say the meeting details will follow shortly.',
    };
  },
};
