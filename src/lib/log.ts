import 'server-only';

// Doc-17 S1 — structured JSON logging, server-side only. Every entry is a
// single JSON line (level/time/message/meta) so a log aggregator can parse
// it; `meta` is recursively scrubbed of anything shaped like customer
// content or a credential before it's ever serialized.

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Exported so Sentry's beforeSend (docs/17 S2) scrubs the same keys instead of
// maintaining a second list that could drift out of sync.
export const SENSITIVE_KEYS = new Set(['text', 'content', 'body', 'key', 'token', 'secret', 'authorization']);
const REDACTED = '[redacted]';
const MAX_DEPTH = 8;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[max-depth]';
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : redact(val, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(level: LogLevel, message: string, meta?: unknown) {
  const entry: Record<string, unknown> = { level, time: new Date().toISOString(), message };
  if (meta !== undefined) entry.meta = redact(meta);

  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (message: string, meta?: unknown) => emit('debug', message, meta),
  info: (message: string, meta?: unknown) => emit('info', message, meta),
  warn: (message: string, meta?: unknown) => emit('warn', message, meta),
  error: (message: string, meta?: unknown) => emit('error', message, meta),
};
