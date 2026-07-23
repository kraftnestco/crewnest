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
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast and loud at startup — never limp along with missing secrets.
  const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
  throw new Error(`[env] Invalid or missing environment variables: ${missing}`);
}

export const env = parsed.data;
export type Env = typeof env;
