import * as Sentry from '@sentry/nextjs';
import { redact, SENSITIVE_KEYS } from '@/lib/log';

// Doc-17 S2 — env-gated bolt-on, exactly the Resend/email pattern (services/email.ts):
// a no-op until SENTRY_DSN is set. No source-map upload wiring (no SENTRY_AUTH_TOKEN
// requirement) — the user provisioning the DSN is the resume point for that, not this.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0,
    beforeSend: (event) => scrub(event),
  });
}

/** Reuses log.ts's sensitive-key redaction so Sentry never receives what structured logs already refuse to. */
export function scrub(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.extra) event.extra = redact(event.extra) as typeof event.extra;
  if (event.contexts) event.contexts = redact(event.contexts) as typeof event.contexts;
  if (event.request) {
    // Cookies carry the Supabase session token (docs/02 §9: never log a decrypted
    // token) — dropped outright rather than key-matched, since "sb-*-auth-token"
    // isn't in the S1 list.
    delete event.request.cookies;
    if (event.request.headers) {
      for (const header of Object.keys(event.request.headers)) {
        if (SENSITIVE_KEYS.has(header.toLowerCase())) delete event.request.headers[header];
      }
    }
    if (event.request.data !== undefined) event.request.data = redact(event.request.data);
  }
  return event;
}
