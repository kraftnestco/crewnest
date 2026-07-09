import { WIDGET_RATE_LIMIT } from '@/lib/constants';

/**
 * Minimal in-memory fixed-window rate limiter for the website widget endpoint.
 *
 * ⚠️ Dev/single-instance only. On multiple serverless instances this does not
 * share state — upgrade to Upstash Redis (or Supabase) before scaling out.
 * See docs/06-INTEGRATIONS.md §2.1.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function checkRateLimit(
  key: string,
  opts: { windowMs?: number; max?: number } = {},
): { allowed: boolean; remaining: number; resetAt: number } {
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
