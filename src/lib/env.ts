import 'server-only';
import { z } from 'zod';

/**
 * Validated, server-only environment access.
 *
 * SECURITY: this module imports `server-only`, so importing it from a Client
 * Component is a build error. Only `NEXT_PUBLIC_*` values may ever reach the
 * browser; the secrets below must never be sent to, or fetched by, a client.
 *
 * See docs/02-SECURITY.md §1 (trust boundaries) and §2 (secrets).
 */
const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  MASTER_OPENAI_KEY: z.string().min(1),
  MASTER_OPENROUTER_KEY: z.string().optional(),
  META_VERIFY_TOKEN: z.string().min(1),
  META_APP_SECRET: z.string().min(1),
  META_GRAPH_VERSION: z.string().default('v21.0'),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  // Optional — email fan-out (docs/14 §3.4, Stage O7) is a no-op until this is set.
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  // Optional — error tracking (docs/17 S2) is a no-op until this is set.
  SENTRY_DSN: z.string().optional(),
  // Optional — Vercel Cron auth (docs/17 §3.1) rejects every request until set.
  CRON_SECRET: z.string().optional(),
  // Optional — authenticates the webhook's "nudge" to the inbound-worker Edge
  // Function (docs/15 §2). Must match the value set via
  // `npx supabase secrets set INBOUND_WORKER_SECRET=...`. Unset ⇒ no nudge is
  // sent and inbound messages simply wait for the next pg_cron tick, which is
  // the pre-existing behaviour — degraded latency, never lost messages.
  INBOUND_WORKER_SECRET: z.string().optional(),
  // Optional — Web Push (docs/21). Push is a no-op until all three are set, the
  // same bolt-on posture as Resend/Sentry. The PRIVATE key is server-only and
  // must never be exposed; only NEXT_PUBLIC_VAPID_PUBLIC_KEY reaches the browser.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
  // Optional — Stripe billing (docs/22). Unlike Resend/push, billing has no
  // meaningful partial state: unset ⇒ the checkout/portal actions refuse with
  // a clear error rather than silently no-op-ing (a paywall that pretends to
  // work but never charges anyone would be a much worse failure mode).
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_STARTER: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast and loud at startup — never limp along with missing secrets.
  const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
  throw new Error(`[env] Invalid or missing environment variables: ${missing}`);
}

export const env = parsed.data;
export type Env = typeof env;
