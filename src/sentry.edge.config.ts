import * as Sentry from '@sentry/nextjs';

// Doc-17 S2 — registered alongside sentry.server.config.ts per Next.js's standard
// instrumentation.ts pattern (proxy.ts runs on the edge runtime). No scrubbing
// needed here: proxy.ts never touches customer content or secrets (see its
// header comment) — there's nothing sensitive for a thrown error to carry.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0,
  });
}
