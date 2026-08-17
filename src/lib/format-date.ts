/**
 * Locale-stable date/time formatters for SSR + client hydration.
 *
 * Bare `toLocaleDateString()` / `toLocaleString()` pick the runtime locale, so
 * a Node SSR pass (often en-US → `7/16/2026`) and a browser hydration pass
 * (e.g. en-GB → `16/07/2026`) emit different text and React throws a hydration
 * mismatch. Pinning `en-GB` keeps both sides identical.
 */

const DATE: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
};

const DATETIME: Intl.DateTimeFormatOptions = {
  ...DATE,
  hour: 'numeric',
  minute: '2-digit',
};

const TIME: Intl.DateTimeFormatOptions = {
  hour: 'numeric',
  minute: '2-digit',
};

export function formatDate(value: string | Date): string {
  return new Date(value).toLocaleDateString('en-GB', DATE);
}

export function formatDateTime(value: string | Date): string {
  return new Date(value).toLocaleString('en-GB', DATETIME);
}

export function formatTime(value: string | Date): string {
  return new Date(value).toLocaleTimeString('en-GB', TIME);
}
