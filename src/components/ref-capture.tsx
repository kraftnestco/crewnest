'use client';

import { useEffect } from 'react';

/**
 * Referral attribution capture (docs/19 G1). The plan-gated widget badge links
 * to `${APP_URL}/?ref=<slug>`, so a referred visitor lands with `?ref=` in the
 * URL. We stash it in a first-party cookie that survives the whole demo→signup
 * funnel; `provisionTenantAction` reads it server-side and records who referred
 * the new tenant. Purely additive analytics — referral *credits* are deferred.
 *
 * Mounted once in the root layout so it captures the ref on whatever public page
 * the visitor first hits, then cleans it out of the URL. No-ops without `?ref`.
 */
const COOKIE = 'cn_ref';
const MAX_AGE_DAYS = 30;

export function RefCapture() {
  useEffect(() => {
    let ref: string | null = null;
    try {
      ref = new URLSearchParams(window.location.search).get('ref');
    } catch {
      return;
    }
    if (!ref) return;

    // Sanitise to slug/id characters and cap length — this value is stored and
    // later read server-side, so keep it boring on the way in.
    const clean = ref.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    if (!clean) return;

    const maxAge = MAX_AGE_DAYS * 24 * 60 * 60;
    document.cookie = `${COOKIE}=${clean}; path=/; max-age=${maxAge}; SameSite=Lax`;

    // Tidy the URL so the ref param doesn't linger or get re-shared.
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('ref');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch {
      /* non-fatal */
    }
  }, []);

  return null;
}
