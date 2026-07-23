import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { log } = await import('./log');

function lastLine(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const call = spy.mock.calls.at(-1);
  return JSON.parse(call?.[0] as string);
}

describe('log', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes debug/info through console.log, warn through console.warn, error through console.error', () => {
    log.debug('d');
    log.info('i');
    expect(logSpy).toHaveBeenCalledTimes(2);

    log.warn('w');
    expect(warnSpy).toHaveBeenCalledTimes(1);

    log.error('e');
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('emits a single JSON line with level/time/message', () => {
    log.info('hello');
    const entry = lastLine(logSpy);
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('hello');
    expect(typeof entry.time).toBe('string');
    expect(new Date(entry.time as string).toISOString()).toBe(entry.time);
  });

  it('omits meta entirely when not provided', () => {
    log.info('no meta');
    const entry = lastLine(logSpy);
    expect('meta' in entry).toBe(false);
  });

  it('redacts sensitive keys case-insensitively, at any nesting depth', () => {
    log.warn('leak check', {
      TOKEN: 'abc123',
      nested: { secret: 'shh', ok: 'fine' },
      Authorization: 'Bearer xyz',
    });
    const entry = lastLine(warnSpy);
    const meta = entry.meta as Record<string, unknown>;
    expect(meta.TOKEN).toBe('[redacted]');
    expect(meta.Authorization).toBe('[redacted]');
    expect((meta.nested as Record<string, unknown>).secret).toBe('[redacted]');
    expect((meta.nested as Record<string, unknown>).ok).toBe('fine');
  });

  it('redacts sensitive keys inside arrays', () => {
    log.warn('array check', { items: [{ content: 'customer text' }, { other: 'kept' }] });
    const entry = lastLine(warnSpy);
    const meta = entry.meta as { items: Record<string, unknown>[] };
    expect(meta.items[0].content).toBe('[redacted]');
    expect(meta.items[1].other).toBe('kept');
  });

  it('serialises Error instances with name/message/stack instead of dropping them as {}', () => {
    const err = new Error('boom');
    log.error('failed', err);
    const entry = lastLine(errorSpy);
    const meta = entry.meta as { name: string; message: string; stack: string };
    expect(meta.name).toBe('Error');
    expect(meta.message).toBe('boom');
    expect(typeof meta.stack).toBe('string');
  });

  it('redacts sensitive keys on an Error found inside meta', () => {
    log.error('failed', { token: 'abc', cause: new Error('inner') });
    const entry = lastLine(errorSpy);
    const meta = entry.meta as { token: string; cause: { message: string } };
    expect(meta.token).toBe('[redacted]');
    expect(meta.cause.message).toBe('inner');
  });

  it('passes through primitive meta (string/number/boolean) unchanged', () => {
    log.info('primitive', 'just a string');
    expect(lastLine(logSpy).meta).toBe('just a string');
  });

  it('caps recursion depth rather than blowing the stack on deeply nested meta', () => {
    let deep: Record<string, unknown> = { value: 'bottom' };
    for (let i = 0; i < 20; i += 1) {
      deep = { child: deep };
    }
    expect(() => log.info('deep', deep)).not.toThrow();
    const entry = lastLine(logSpy);
    expect(JSON.stringify(entry)).toContain('[max-depth]');
  });
});
