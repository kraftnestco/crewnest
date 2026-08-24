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
  // Optional — Facebook Login for Business (docs/27 §5 C2). Unset ⇒ the
  // Connect button's initiate route refuses loudly (same fail-loud posture
  // as Stripe/Safepay above), same as before this shipped: Messenger/
  // Instagram just stay on the C1 concierge request path.
  META_APP_ID: z.string().optional(),
  // Optional — WhatsApp Embedded Signup configuration id from the Meta app's
  // WhatsApp product. Unset ⇒ Connect WhatsApp uses standard OAuth scopes instead.
  META_WHATSAPP_CONFIG_ID: z.string().optional(),
  // Optional — "Instagram API with Instagram Login" (Meta App > Instagram >
  // API setup with Instagram login). A DIFFERENT app id/secret pair from
  // META_APP_ID/META_APP_SECRET above, even though it's configured inside the
  // same Meta App dashboard entry — Meta issues Instagram-specific OAuth
  // client credentials for this product. Powers "Connect with Instagram"
  // (no Facebook Page required). Unset ⇒ that button's initiate route
  // refuses loudly; the Facebook-Page-linked Instagram path is unaffected.
  INSTAGRAM_APP_ID: z.string().optional(),
  INSTAGRAM_APP_SECRET: z.string().optional(),
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
  // Optional — Cal.com (docs/24 §4.4), used ONLY to mint a meeting link for
  // tenants with booking_mode='calcom'. Unset ⇒ those tenants still get their
  // appointment booked, just without a link (§4.3) — never a crash.
  CALCOM_API_KEY: z.string().optional(),
  CALCOM_EVENT_TYPE_ID: z.string().optional(),
  /** Fixed attendee address for every Cal.com booking — see docs/24 §4.4 for why it isn't the customer's. */
  CALCOM_ATTENDEE_EMAIL: z.string().optional(),
  // Optional — Stripe billing (docs/22). Unlike Resend/push, billing has no
  // meaningful partial state: unset ⇒ the checkout/portal actions refuse with
  // a clear error rather than silently no-op-ing (a paywall that pretends to
  // work but never charges anyone would be a much worse failure mode).
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_STARTER: z.string().optional(),
  /** Growth ($49) — added alongside the tier; unset ⇒ Growth checkout refuses loudly, like the others. */
  STRIPE_PRICE_GROWTH: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),
  STRIPE_PRICE_ENTERPRISE: z.string().optional(),
  // Optional — Safepay billing for Pakistani tenants (docs/25). Same posture as
  // Stripe above: unset ⇒ checkout/portal refuse loudly rather than no-op.
  SAFEPAY_SECRET_KEY: z.string().optional(),
  SAFEPAY_WEBHOOK_SECRET: z.string().optional(),
  SAFEPAY_PLAN_STARTER: z.string().optional(),
  /** Growth ($49) — see STRIPE_PRICE_GROWTH. */
  SAFEPAY_PLAN_GROWTH: z.string().optional(),
  SAFEPAY_PLAN_PRO: z.string().optional(),
  SAFEPAY_PLAN_ENTERPRISE: z.string().optional(),
  /** 'production' | 'sandbox' — Safepay's API host. Defaults to sandbox so a
   *  half-configured deploy can never take real money by accident. */
  SAFEPAY_ENVIRONMENT: z.enum(['production', 'sandbox']).default('sandbox'),
  /**
   * USD→PKR rate used to convert PAYWALL_PLANS' USD prices at checkout time.
   *
   * Deliberately an env var, not a live FX API call: a rate-feed outage must
   * never block a tenant from subscribing, and a checkout amount must be
   * reproducible when reconciling a charge later. Safepay bills a FIXED
   * recurring amount, so this rate is locked per subscription at subscribe
   * time — see docs/25 §3.2 for what that means and how to reprice.
   */
  SAFEPAY_USD_TO_PKR: z.coerce.number().positive().default(278),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast and loud at startup — never limp along with missing secrets.
  const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
  throw new Error(`[env] Invalid or missing environment variables: ${missing}`);
}

export const env = parsed.data;
export type Env = typeof env;
