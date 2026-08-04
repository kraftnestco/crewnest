/**
 * "Upcoming" means NOT FINISHED — an appointment in progress must stay on
 * screen, and one that has ended must not.
 *
 * Two earlier attempts were wrong in opposite directions: `starts_at >= now`
 * dropped a 4:30pm booking at 4:30pm, while a blanket 4-hour lookback still
 * listed it at 6:15pm, long after it ended. A generated `ends_at` column was
 * the obvious fix but Postgres rejects it (42P17, the expression is not
 * immutable), so the end time is computed here instead.
 *
 * The DB query fetches from a bounded lookback — wide enough to include any
 * appointment that could still be running — and this filters that set exactly.
 */
export const MAX_APPOINTMENT_LOOKBACK_MINUTES = 480;

export function isUnfinished(
  appointment: { starts_at: string; duration_minutes: number },
  now: Date = new Date(),
): boolean {
  return new Date(appointment.starts_at).getTime() + appointment.duration_minutes * 60_000 > now.getTime();
}
