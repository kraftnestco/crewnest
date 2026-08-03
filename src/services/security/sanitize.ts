import { HUMAN_HANDOFF_TOKEN, MAX_INBOUND_CHARS, SIGNAL_TOKENS } from '@/lib/constants';
import type { AlertSignal } from '@/types/domain';

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

  // Same neutralisation for the alert-signal tokens (see extractSignal below).
  for (const token of Object.values(SIGNAL_TOKENS)) {
    text = text.split(token).join(token.toLowerCase());
  }

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

/** The first alert signal the ASSISTANT output requested, if any (checked in fixed priority order). */
export function extractSignal(text: string): AlertSignal | null {
  for (const [signal, token] of Object.entries(SIGNAL_TOKENS) as [AlertSignal, string][]) {
    if (text.includes(token)) return signal;
  }
  return null;
}

/** Strip all signal control tokens from assistant output before storing/echoing. */
export function stripSignalTokens(text: string): string {
  let result = text;
  for (const token of Object.values(SIGNAL_TOKENS)) {
    result = result.split(token).join('');
  }
  return result.trim();
}

/** Clearly-escalating phrases the during-handoff heuristic below watches for (see its doc comment). */
const ESCALATION_KEYWORDS = [
  'unacceptable',
  'ridiculous',
  'scam',
  'still waiting',
  'terrible service',
  'worst experience',
  'refund now',
  'cancel my order',
  'never buying',
  'fed up',
  'furious',
  'disgusted',
  'talk to a lawyer',
  'report you',
  'this is fraud',
  'money back',
  'this is a joke',
  'done with this',
];

const REPEATED_PUNCTUATION_RE = /[!?]{2,}/;

/**
 * Keyword-only, no-LLM escalation backstop for CUSTOMER text arriving while a session
 * is already in human handoff (docs/18 §4 finding #10). The LLM is correctly skipped
 * once `is_human_handoff=true`, so no new alert_signal can be generated from it — this
 * plugs that blind spot with a blunt heuristic (angry-keyword list, repeated `!!`/`??`
 * punctuation, mostly-caps "shouting"), not a real sentiment model. Explicitly a
 * backstop: disclosed as such wherever it fires, matching how the original heuristic
 * this replaced was framed before the LLM-based signal (memory) superseded it.
 */
export function detectEscalationKeywords(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const lower = trimmed.toLowerCase();
  if (ESCALATION_KEYWORDS.some((kw) => lower.includes(kw))) return true;
  if (REPEATED_PUNCTUATION_RE.test(trimmed)) return true;

  const letters = trimmed.replace(/[^a-zA-Z]/g, '');
  if (letters.length >= 8) {
    const capsCount = (trimmed.match(/[A-Z]/g) ?? []).length;
    if (capsCount / letters.length > 0.7) return true;
  }

  return false;
}

/**
 * Strip Markdown formatting from assistant output before it is stored or sent.
 *
 * The prompt already forbids markdown explicitly ("no markdown bold (**), no
 * headers, no tables") — and a real reply on Instagram still arrived as
 * "*KN-0803-5*" (2026-08-03). Prompt rules are advisory; a weaker model ignores
 * them. Meta channels render none of this, so the customer sees the literal
 * characters. This is the enforcement the prompt instruction cannot be.
 *
 * Deliberately conservative — it unwraps emphasis and headings rather than
 * trying to parse Markdown properly. Anything ambiguous is left alone: a
 * mangled price or product name would be far worse than a stray asterisk.
 */
export function stripMarkdown(text: string): string {
  let out = text;

  // Bold/italic wrappers. Longest first so ** isn't half-eaten by the * rule.
  // Requires non-space immediately inside, so "2 * 3" and "5*" survive.
  out = out.replace(/\*\*\*(\S(?:[^*]*\S)?)\*\*\*/g, '$1');
  out = out.replace(/\*\*(\S(?:[^*]*\S)?)\*\*/g, '$1');
  // Single-asterisk emphasis must open on a letter/digit and contain no comma
  // or newline. Without that, "Sizes: S*, M*" reads the span between the two
  // asterisks (", M") as emphasis and eats both markers — footnote-style
  // asterisks after sizes are entirely plausible in a shop's catalogue.
  out = out.replace(/\*([A-Za-z0-9](?:[^*,\n]*[^\s*,])?)\*/g, '$1');
  out = out.replace(/__(\S(?:[^_]*\S)?)__/g, '$1');

  // Inline code and code fences — the text inside is usually what matters.
  out = out.replace(/```[a-z]*\n?([\s\S]*?)```/g, '$1');
  out = out.replace(/`([^`\n]+)`/g, '$1');

  // Leading heading markers ("## Services" -> "Services").
  out = out.replace(/^#{1,6}\s+/gm, '');

  // Markdown links: keep the label, drop the target. The raw URL would be
  // noise, and Meta linkifies bare URLs anyway when we do want one.
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1');

  // Bullet markers become a simple dash; list structure still reads fine as
  // plain text and this avoids a wall of asterisks.
  out = out.replace(/^\s*[*+]\s+/gm, '- ');

  return out.trim();
}
