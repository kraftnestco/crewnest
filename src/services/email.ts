import 'server-only';
import { env } from '@/lib/env';

/**
 * Minimal Resend REST wrapper (docs/14 §3.4, Stage O7) — a raw `fetch` POST to
 * Resend's HTTP API, deliberately with no `resend` npm dependency. Callers must
 * check `env.RESEND_API_KEY` themselves; this throws on failure so the caller's
 * best-effort try/catch (services/notifications.ts) decides how to log it.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'ClerkNest <onboarding@resend.dev>';

export interface SendEmailInput {
  to: string[];
  subject: string;
  text: string;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  if (!env.RESEND_API_KEY || input.to.length === 0) return;

  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL || DEFAULT_FROM,
      to: input.to,
      subject: input.subject,
      text: input.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend send failed (${res.status}): ${body}`);
  }
}
