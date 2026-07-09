import { HUMAN_HANDOFF_TOKEN, MAX_INBOUND_CHARS } from '@/lib/constants';

/**
 * Sanitise untrusted customer text before it is stored or sent to the model.
 * This is a prompt-injection guardrail, NOT SQL protection (we use the Supabase
 * SDK / parameterised queries everywhere). See docs/02-SECURITY.md §7.
 *
 * - strips control characters (except normal whitespace \t \n \r)
 * - caps length
 * - neutralises control-token look-alikes so user text can never spoof
 *   [HUMAN_HANDOFF] (the orchestrator only honours that token from ASSISTANT output)
 */
export function sanitizeInbound(input: string): string {
  let text = (input ?? '').normalize('NFKC');

  // Remove control chars except \t (09) \n (0A) \r (0D).
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Neutralise any attempt to inject the handoff control token from user text.
  text = text.split(HUMAN_HANDOFF_TOKEN).join('[human-handoff]');

  // Collapse excessive whitespace and cap length.
  text = text.replace(/\s{4,}/g, '   ').trim();
  if (text.length > MAX_INBOUND_CHARS) text = text.slice(0, MAX_INBOUND_CHARS);

  return text;
}

/** Strip the handoff control token from assistant output before storing/echoing. */
export function stripHandoffToken(text: string): string {
  return text.split(HUMAN_HANDOFF_TOKEN).join('').trim();
}

/** True if the ASSISTANT output requested human takeover. */
export function assistantRequestedHandoff(text: string): boolean {
  return text.includes(HUMAN_HANDOFF_TOKEN);
}
