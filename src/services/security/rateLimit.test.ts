import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRateLimit } from './rateLimit';
import { WIDGET_RATE_LIMIT } from '@/lib/constants';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('checkRateLimit', () => {
  it('allows requests up to max within a window, then blocks', () => {
    const opts = { windowMs: 1000, max: 3 };
    const key = 'fixed-window-key';

    const r1 = checkRateLimit(key, opts);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = checkRateLimit(key, opts);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = checkRateLimit(key, opts);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);

    const r4 = checkRateLimit(key, opts);
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
  });

  it('resets the window once resetAt has passed', () => {
    const opts = { windowMs: 1000, max: 1 };
    const key = 'reset-key';

    expect(checkRateLimit(key, opts).allowed).toBe(true);
    expect(checkRateLimit(key, opts).allowed).toBe(false);

    vi.advanceTimersByTime(1001);

    const afterReset = checkRateLimit(key, opts);
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.remaining).toBe(0);
  });

  it('tracks independent buckets per key', () => {
    const opts = { windowMs: 1000, max: 1 };
    expect(checkRateLimit('key-a', opts).allowed).toBe(true);
    expect(checkRateLimit('key-b', opts).allowed).toBe(true);
    expect(checkRateLimit('key-a', opts).allowed).toBe(false);
    expect(checkRateLimit('key-b', opts).allowed).toBe(false);
  });

  it('falls back to WIDGET_RATE_LIMIT when no options are given', () => {
    const key = 'default-opts-key';
    const result = checkRateLimit(key);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(WIDGET_RATE_LIMIT.max - 1);
    expect(result.resetAt).toBe(Date.now() + WIDGET_RATE_LIMIT.windowMs);
  });
});
