import { type NextRequest } from 'next/server';
import * as tenants from '@/services/tenants';
import { env } from '@/lib/env';
import { log } from '@/lib/log';

/**
 * Public widget config (docs/19 G1). The embed script fetches this to decide
 * whether to show the "Powered by ClerkNest" referral badge: free tenants show it
 * (a growth surface), paid tenants have it removed. Returns only public,
 * non-sensitive data (a boolean + a marketing URL) — never keys or plan details.
 *
 * FAIL OPEN: any unknown key / error still returns `branding: true`, so a
 * transient failure defaults to *showing* the badge rather than a paid tenant
 * accidentally losing branding removal, and a free tenant is never silently
 * un-branded. Least surprise for both sides.
 */
export const runtime = 'nodejs';

const FALLBACK = { branding: true, referralUrl: env.NEXT_PUBLIC_APP_URL };

export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin');
  const key = req.nextUrl.searchParams.get('key');
  if (!key) return json(FALLBACK, 200, origin);

  try {
    const tenant = await tenants.resolveByWidgetKey(key);
    if (!tenant) return json(FALLBACK, 200, origin);

    // Paid = any tier other than the free plan. A pending paid selection
    // (plan_status set, plan still 'free') keeps the badge until it's activated.
    const isPaid = tenant.plan !== 'free';
    const ref = tenant.slug ?? tenant.id;
    return json(
      { branding: !isPaid, referralUrl: `${env.NEXT_PUBLIC_APP_URL}/?ref=${encodeURIComponent(ref)}` },
      200,
      origin,
    );
  } catch (err) {
    log.error('[widget] config failed', { error: err instanceof Error ? err.message : 'unknown' });
    return json(FALLBACK, 200, origin);
  }
}

// CORS preflight — echo the requesting origin (this endpoint returns only public data).
export async function OPTIONS(req: NextRequest) {
  return json(null, 204, req.headers.get('origin'));
}

function json(payload: unknown, status: number, origin: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Vary'] = 'Origin';
  }
  // Short cache so paid-plan changes propagate quickly without hammering the DB.
  headers['Cache-Control'] = 'public, max-age=300';
  return new Response(payload === null ? null : JSON.stringify(payload), { status, headers });
}
