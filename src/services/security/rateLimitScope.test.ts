import { describe, it, expect, vi } from 'vitest';
import { checkRateLimit } from './rateLimit';
import { WIDGET_RATE_LIMIT, DEMO_SESSION_RATE_LIMIT } from '@/lib/constants';

// rateLimit.ts imports lib/log.ts, which is 'server-only' — mocked exactly as
// the sibling rateLimit.test.ts does. These tests only take the in-memory
// branch (NODE_ENV is 'test' under vitest), so no env stubbing is needed.
vi.mock('server-only', () => ({}));

/**
 * Regression cover for the cross-window bucket collision.
 *
 * `increment_rate_limit_bucket` keys rows on (bucket_key, window_start) only, so
 * two limits with DIFFERENT windowMs values shared a counter whenever their
 * window_start coincided — guaranteed at every UTC midnight, where the 60s
 * widget window and the 24h demo window both floor to the same instant. The
 * bucket key now carries windowMs so the two can never alias.
 *
 * These exercise the in-memory branch (NODE_ENV !== 'production'), which is
 * scoped identically to the DB branch precisely so this is testable.
 */
describe('rate limit — window scoping', () => {
  it('does not share a counter between two limits with the same key but different windows', async () => {
    const key = `collision-probe-${Date.now()}`;

    // Exhaust a tight 1-per-window limit.
    const first = await checkRateLimit(key, { windowMs: 60_000, max: 1 });
    expect(first.allowed).toBe(true);
    const second = await checkRateLimit(key, { windowMs: 60_000, max: 1 });
    expect(second.allowed).toBe(false); // that limit is now spent

    // A DIFFERENT window size using the same caller key must be untouched by the
    // increments above. Before the fix this inherited the exhausted counter.
    const otherWindow = await checkRateLimit(key, { windowMs: 24 * 60 * 60 * 1000, max: 1 });
    expect(otherWindow.allowed).toBe(true);
  });

  it('keeps the real widget and demo limits independent', async () => {
    const key = `shared-key-${Date.now()}`;

    for (let i = 0; i < WIDGET_RATE_LIMIT.max; i++) {
      await checkRateLimit(key, WIDGET_RATE_LIMIT);
    }
    expect((await checkRateLimit(key, WIDGET_RATE_LIMIT)).allowed).toBe(false);

    // The demo limit shares the caller key but has its own window — still fresh.
    expect((await checkRateLimit(key, DEMO_SESSION_RATE_LIMIT)).allowed).toBe(true);
  });

  it('still enforces each limit within its own window', async () => {
    const key = `enforce-${Date.now()}`;
    expect((await checkRateLimit(key, { windowMs: 60_000, max: 2 })).allowed).toBe(true);
    expect((await checkRateLimit(key, { windowMs: 60_000, max: 2 })).allowed).toBe(true);
    expect((await checkRateLimit(key, { windowMs: 60_000, max: 2 })).allowed).toBe(false);
  });
});
