import 'server-only';
import { z } from 'zod';
import * as appointments from '@/services/appointments';
import type { Slot } from '@/services/hours';
import type { ToolContext, ToolExecutor } from './registry';

/**
 * check_availability — day-first booking flow (docs/24 §4.1).
 *
 * Reciting eight slots at a customer reads like a machine dumping a table,
 * especially on a phone. This narrows the conversation instead: which day, then
 * what time, then check that specific time.
 *
 * Three modes, by which arguments arrive:
 *   (none)      → the days that actually have availability, so the AI can ask
 *                 "which day suits you?" without inventing options.
 *   day         → confirm the day is bookable and ask for a time.
 *   day + time  → the answer that matters: is THAT time free? If not, the
 *                 nearest few alternatives ON THAT DAY, so the customer is
 *                 never left guessing blindly.
 *
 * Availability is always computed server-side from the tenant's own hours,
 * closures, lead time and existing bookings. The model supplies only what the
 * customer said.
 */

const argsSchema = z.object({
  /** Whatever the customer called the day: "thursday", "tomorrow", "2026-08-07". */
  day: z.string().optional(),
  /** Whatever they called the time: "4pm", "16:00", "half four". */
  time: z.string().optional(),
});

/** Parse a customer's spoken time to minutes-since-midnight, or null if unclear. */
function parseTimeHint(hint: string): number | null {
  const raw = hint.trim().toLowerCase().replace(/\./g, ':');

  // 4pm / 4 pm / 4:30pm / 16:00 / 16.00
  const m = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!m) return null;

  let hour = Number(m[1]);
  const mins = m[2] ? Number(m[2]) : 0;
  const suffix = m[3];

  if (Number.isNaN(hour) || hour > 23 || mins > 59) return null;

  if (suffix === 'pm' && hour < 12) hour += 12;
  if (suffix === 'am' && hour === 12) hour = 0;
  // No am/pm on a small number: assume business hours rather than 5am.
  // "5" almost always means 5pm to someone booking an appointment.
  if (!suffix && hour >= 1 && hour <= 7) hour += 12;

  return hour * 60 + mins;
}

/** Minutes-since-midnight for a slot, in the tenant's timezone. */
function slotMinutes(slot: Slot, timezone: string | null): number {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone || 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(slot.startsAt);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? '0');
  return g('hour') * 60 + g('minute');
}

/** "Tue 4 Aug" — the day label, without the time. */
function dayLabel(slot: Slot, timezone: string | null): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone || 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(slot.startsAt);
}

/** "3:00 pm" — the time alone, for offering within an already-agreed day. */
function timeLabel(slot: Slot, timezone: string | null): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone || 'UTC',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(slot.startsAt);
}

export const checkAvailabilityTool: ToolExecutor = {
  def: {
    name: 'check_availability',
    description:
      'Check appointment availability. Call with NO arguments to find which days are free, then with `day` once the customer picks one, then with `day` and `time` once they name a time. Never list lots of times at the customer — ask which day first, then what time.',
    parameters: {
      type: 'object',
      properties: {
        day: {
          type: 'string',
          description: 'The day the customer named, in their own words: "thursday", "tomorrow", "2026-08-07".',
        },
        time: {
          type: 'string',
          description: 'The time the customer named, in their own words: "4pm", "16:00". Only send this with a day.',
        },
      },
      required: [],
    },
  },
  argsSchema,
  async execute(args: unknown, ctx: ToolContext) {
    const { day, time } = args as z.infer<typeof argsSchema>;
    const tz = ctx.tenant.timezone;

    // --- Mode 1: no day yet — which days can we offer? ---------------------
    if (!day) {
      const slots = await appointments.getAvailableSlots(ctx.tenant, 500);
      if (slots.length === 0) {
        return {
          ok: false,
          message:
            'There is no availability in the booking window at all. Apologise and offer to take their details so the business can follow up.',
        };
      }
      const days: string[] = [];
      for (const s of slots) {
        const label = dayLabel(s, tz);
        if (!days.includes(label)) days.push(label);
        if (days.length >= 5) break;
      }
      return {
        ok: true,
        available_days: days,
        message:
          'Ask the customer WHICH DAY suits them, mentioning these days naturally. Do not list any times yet.',
      };
    }

    // --- Resolve the day -----------------------------------------------------
    const resolved = appointments.resolveDayHint(day, tz);
    if (!resolved) {
      return {
        ok: false,
        message: `Could not tell which day "${day}" means. Ask the customer to name the day again, e.g. "Thursday" or a date.`,
      };
    }

    const daySlots = await appointments.getSlotsForDay(ctx.tenant, resolved);
    if (daySlots.length === 0) {
      // Offer the next days that DO work rather than a bare "no".
      const all = await appointments.getAvailableSlots(ctx.tenant, 500);
      const alt: string[] = [];
      for (const s of all) {
        const label = dayLabel(s, tz);
        if (!alt.includes(label)) alt.push(label);
        if (alt.length >= 3) break;
      }
      return {
        ok: false,
        requested_day: resolved,
        alternative_days: alt,
        message: 'That day is fully booked or closed. Say so and offer these other days instead.',
      };
    }

    // --- Mode 2: day only — ask for a time ---------------------------------
    if (!time) {
      const earliest = timeLabel(daySlots[0], tz);
      const latest = timeLabel(daySlots[daySlots.length - 1], tz);
      return {
        ok: true,
        day: dayLabel(daySlots[0], tz),
        opens: earliest,
        closes: latest,
        message: `That day works — appointments run from ${earliest} to ${latest}. Ask the customer WHAT TIME they'd like. Do not list every slot.`,
      };
    }

    // --- Mode 3: day + time — the actual check ------------------------------
    const wanted = parseTimeHint(time);
    if (wanted === null) {
      return {
        ok: false,
        message: `Could not tell what time "${time}" means. Ask the customer to say the time again, e.g. "4pm".`,
      };
    }

    const exact = daySlots.find((s) => slotMinutes(s, tz) === wanted);
    if (exact) {
      return {
        ok: true,
        available: true,
        // Echoed verbatim into book_appointment — never reconstructed.
        starts_at: exact.startsAt.toISOString(),
        label: exact.label,
        message: `${exact.label} is free. Confirm it with the customer and get their name, then call book_appointment with this exact starts_at.`,
      };
    }

    // Not free — offer the nearest times on the same day, closest first, so the
    // customer isn't left guessing which times might work.
    const nearest = [...daySlots]
      .sort((a, b) => Math.abs(slotMinutes(a, tz) - wanted) - Math.abs(slotMinutes(b, tz) - wanted))
      .slice(0, 3)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

    return {
      ok: false,
      available: false,
      nearest_times: nearest.map((s) => ({ starts_at: s.startsAt.toISOString(), label: timeLabel(s, tz) })),
      message:
        'That exact time is not available. Tell the customer, and offer these nearby times on the same day as alternatives.',
    };
  },
};
