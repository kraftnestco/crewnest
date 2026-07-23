import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({ init: vi.fn() }));

const { scrub } = await import('./sentry.server.config');

type FakeEvent = Parameters<typeof scrub>[0];

function run(event: Record<string, unknown>): Record<string, unknown> {
  return scrub(event as unknown as FakeEvent) as unknown as Record<string, unknown>;
}

function obj(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

describe('scrub (Sentry beforeSend)', () => {
  it('redacts sensitive keys in event.extra and event.contexts', () => {
    const result = run({
      extra: { token: 'abc', ok: 'fine' },
      contexts: { custom: { secret: 'shh' } },
    });
    const extra = obj(result.extra);
    const contexts = obj(result.contexts);
    expect(extra.token).toBe('[redacted]');
    expect(extra.ok).toBe('fine');
    expect(obj(contexts.custom).secret).toBe('[redacted]');
  });

  it('drops cookies outright and redacts sensitive header names', () => {
    const result = run({
      request: {
        cookies: { 'sb-project-auth-token': 'eyJ...' },
        headers: { Authorization: 'Bearer xyz', 'x-request-id': 'kept' },
      },
    });
    const request = obj(result.request);
    const headers = obj(request.headers);
    expect(request.cookies).toBeUndefined();
    expect(headers.Authorization).toBeUndefined();
    expect(headers['x-request-id']).toBe('kept');
  });

  it('redacts sensitive keys inside request.data', () => {
    const result = run({ request: { data: { text: 'customer message', to: 'kept' } } });
    const data = obj(obj(result.request).data);
    expect(data.text).toBe('[redacted]');
    expect(data.to).toBe('kept');
  });

  it('is a no-op on an event with no extra/contexts/request', () => {
    const result = run({ message: 'plain event' });
    expect(result).toEqual({ message: 'plain event' });
  });
});
