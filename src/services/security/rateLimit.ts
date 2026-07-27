import { WIDGET_RATE_LIMIT } from '@/lib/constants';
import { log } from '@/lib/log';

/**
 * Rate limiter for the website widget endpoint (the only unauthenticated
 * caller — the Meta path is signature-authenticated and never calls this).
 *
 * docs/15-RELIABILITY-AND-DURABILITY.md §5: the in-memory version below is
 * dev/single-instance only — on multiple Vercel serverless instances each has
 * its own Map, so the abuse ceiling becomes `max × instanceCount`, porous
 * exactly when it matters (a burst spins up many instances). Production uses
 * `checkRateLimitDb`, a Postgres fixed-window counter
 * (`public.rate_limit_buckets`, migration 0029) shared across every instance.
 * `checkRateLimit` picks between them by `NODE_ENV` so local `npm run dev`
 * never pays a DB round-trip — call sites just `await` either way, since the
 * in-memory path already returns synchronously-resolved values through a
 * Promise wrapper below.
 */

type RateLimitResult = { allowed: boolean; remaining: number; resetAt: number };

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** In-memory fixed-window limiter — dev/test only, see module doc above. */
function checkRateLimitMemory(
  key: string,
  opts: { windowMs?: number; max?: number } = {},
): RateLimitResult {
  const windowMs = opts.windowMs ?? WIDGET_RATE_LIMIT.windowMs;
  const max = opts.max ?? WIDGET_RATE_LIMIT.max;
  const now = Date.now();

  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: max - 1, resetAt };
  }

  b.count += 1;
  const allowed = b.count <= max;
  return { allowed, remaining: Math.max(0, max - b.count), resetAt: b.resetAt };
}

/**
 * Postgres-backed fixed-window limiter (§5) — one atomic round-trip
 * (`increment_rate_limit_bucket`, migration 0035, an `insert ... on conflict
 * do update set count = count + 1 returning count` function — a plain
 * supabase-js `.upsert()` can't express "increment on conflict," only
 * "replace on conflict," so this needs a real SQL function) shares state
 * across every serverless instance. One indexed round-trip per widget
 * request; acceptable because the widget is precisely the cheap-abuse surface
 * being protected, and it's already the only caller.
 *
 * On any DB error, FAILS OPEN (allowed: true) rather than blocking real
 * traffic on an infra hiccup — the widget's own per-tenant `WIDGET_TENANT_RATE_LIMIT`
 * fallback bucket and the free-plan session/cost caps upstream are the backstops
 * if this ever silently no-ops during an outage; logged so it's visible, not silent.
 *
 * `createServiceClient` is imported dynamically (not at module top-level) so
 * that importing this file — and running the in-memory path's unit tests —
 * never pulls in `lib/env.ts`'s eager env-var validation. That validation is
 * correct for the real app (fail fast and loud at startup) but has no place
 * running during a fast, isolated unit test of the in-memory branch.
 */
async function checkRateLimitDb(
  key: string,
  opts: { windowMs?: number; max?: number } = {},
): Promise<RateLimitResult> {
  const windowMs = opts.windowMs ?? WIDGET_RATE_LIMIT.windowMs;
  const max = opts.max ?? WIDGET_RATE_LIMIT.max;
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;

  try {
    const { createServiceClient } = await import('@/lib/supabase/service');
    const svc = createServiceClient();
    const { data, error } = await svc.rpc('increment_rate_limit_bucket', {
      p_bucket_key: key,
      p_window_start: windowStart,
    });
    if (error) throw error;

    const count = data as number;
    return { allowed: count <= max, remaining: Math.max(0, max - count), resetAt };
  } catch (err) {
    log.error('[rateLimit] Postgres bucket failed — failing open', {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    return { allowed: true, remaining: max, resetAt };
  }
}

/** Chooses the in-memory (dev) or Postgres-backed (prod) implementation. See module doc above. */
export async function checkRateLimit(
  key: string,
  opts: { windowMs?: number; max?: number } = {},
): Promise<RateLimitResult> {
  if (process.env.NODE_ENV !== 'production') return checkRateLimitMemory(key, opts);
  return checkRateLimitDb(key, opts);
}
