import 'server-only';
import { z } from 'zod';
import * as appointments from '@/services/appointments';
import type { ToolContext, ToolExecutor } from './registry';

/**
 * check_availability — offers concrete bookable slots (docs/24 §4.1).
 *
 * Deliberately takes no arguments the model could get wrong. Availability is
 * computed entirely server-side from the tenant's own hours, closures, lead
 * time and existing bookings; the model's job is only to read the returned
 * labels out to the customer.
 */

const argsSchema = z.object({});

export const checkAvailabilityTool: ToolExecutor = {
  def: {
    name: 'check_availability',
    description:
      "Get the next available appointment slots for this business. Call this when the customer wants to book, asks about availability, or asks when you're free. Read the returned slot labels back to the customer and ask which they'd like.",
    parameters: { type: 'object', properties: {}, required: [] },
  },
  argsSchema,
  async execute(_args: unknown, ctx: ToolContext) {
    const slots = await appointments.getAvailableSlots(ctx.tenant, 8);

    if (slots.length === 0) {
      return {
        ok: false,
        slots: [],
        message:
          'No slots are available in the booking window. Apologise and offer to take their details so the business can follow up.',
      };
    }

    return {
      ok: true,
      // `startsAt` is the exact value book_appointment must be given back —
      // the model echoes it verbatim rather than reconstructing a time.
      slots: slots.map((s) => ({ starts_at: s.startsAt.toISOString(), label: s.label })),
      message: 'Offer these times to the customer and ask which one they want.',
    };
  },
};
