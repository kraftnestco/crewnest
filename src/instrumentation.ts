import * as Sentry from '@sentry/nextjs';

// Doc-17 S2 — Next.js's standard registration point for the Sentry SDK
// (https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup).
// Both branches are no-ops without SENTRY_DSN (see sentry.*.config.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Captures errors thrown (uncaught) in Server Components, Route Handlers, and
// proxy.ts — the blanket net behind the explicit capture calls in the webhook
// and widget routes, which handle the *caught* case.
export const onRequestError = Sentry.captureRequestError;
