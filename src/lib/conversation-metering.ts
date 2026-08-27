import { CONVERSATION_SESSION_WINDOW_MS } from '@/lib/entitlements';

/** Start of the current UTC calendar month. */
export function startOfUtcMonth(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

/**
 * Whether this inbound turn should consume a monthly conversation slot.
 * True when there is no prior customer message, or the last one was ≥ 24h ago.
 */
export function isNewBillableConversation(
  lastUserMessageIso: string | null,
  now = new Date(),
  windowMs = CONVERSATION_SESSION_WINDOW_MS,
): boolean {
  if (!lastUserMessageIso) return true;
  const last = new Date(lastUserMessageIso).getTime();
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= windowMs;
}
