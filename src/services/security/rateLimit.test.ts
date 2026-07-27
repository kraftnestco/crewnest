import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WIDGET_RATE_LIMIT } from '@/lib/constants';

// rateLimit.ts imports lib/log.ts, which is 'server-only' — mocked here the
// same way log.test.ts does. The Postgres branch (docs/15-RELIABILITY-AND-
// DURABILITY.md §5) additionally dynamically imports lib/supabase/service.ts
// (and, transitively, lib/env.ts's eager env-var validation) only when it
// actually runs — these tests never take that branch (NODE_ENV is 'test'
// under vitest, which checkRateLimit treats the same as dev), so only the
// server-only mock below is needed, not any env stubbing.
vi.mock('server-only', () => ({}));

const { checkRateLimit } = await import('./rateLimit');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

// NODE_ENV is 'test' under vitest, which checkRateLimit treats the same as
// dev (anything not 'production') — so these exercise the in-memory path,
// same behavior these tests always verified. checkRateLimit is now async
// (docs/15-RELIABILITY-AND-DURABILITY.md §5's production Postgres path
// requires a DB round-trip) so every call is awaited below.
describe('checkRateLimit', () => {
  it('allows requests up to max within a window, then blocks', async () => {
    const opts = { windowMs: 1000, max: 3 };
    const key = 'fixed-window-key';

    const r1 = await checkRateLimit(key, opts);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = await checkRateLimit(key, opts);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = await checkRateLimit(key, opts);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);

    const r4 = await checkRateLimit(key, opts);
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
  });

  it('resets the window once resetAt has passed', async () => {
    const opts = { windowMs: 1000, max: 1 };
    const key = 'reset-key';

    expect((await checkRateLimit(key, opts)).allowed).toBe(true);
    expect((await checkRateLimit(key, opts)).allowed).toBe(false);

    vi.advanceTimersByTime(1001);

    const afterReset = await checkRateLimit(key, opts);
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.remaining).toBe(0);
  });

  it('tracks independent buckets per key', async () => {
    const opts = { windowMs: 1000, max: 1 };
    expect((await checkRateLimit('key-a', opts)).allowed).toBe(true);
    expect((await checkRateLimit('key-b', opts)).allowed).toBe(true);
    expect((await checkRateLimit('key-a', opts)).allowed).toBe(false);
    expect((await checkRateLimit('key-b', opts)).allowed).toBe(false);
  });

  it('falls back to WIDGET_RATE_LIMIT when no options are given', async () => {
    const key = 'default-opts-key';
    const result = await checkRateLimit(key);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(WIDGET_RATE_LIMIT.max - 1);
    expect(result.resetAt).toBe(Date.now() + WIDGET_RATE_LIMIT.windowMs);
  });
});
