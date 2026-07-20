import { type NextRequest } from 'next/server';
import { checkRateLimit } from '@/services/security/rateLimit';
import { DEMO_SESSION_RATE_LIMIT } from '@/lib/constants';

/**
 * Gates a new public demo session (docs: "try it for your business" plan,
 * Phase B). Called once, right before chat unlocks (email-capture submit) —
 * NOT per message. No tenant, no DB; just an IP-keyed counter.
 */
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = checkRateLimit(`demo:${ip}`, DEMO_SESSION_RATE_LIMIT);
  return new Response(JSON.stringify({ allowed: rl.allowed, remaining: rl.remaining }), {
    status: rl.allowed ? 200 : 429,
    headers: { 'Content-Type': 'application/json' },
  });
}
