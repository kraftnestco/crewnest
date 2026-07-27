import { type NextRequest } from 'next/server';
import { checkRateLimit } from '@/services/security/rateLimit';
import { DEMO_SESSION_RATE_LIMIT } from '@/lib/constants';
import { demoLeadRequestSchema } from '@/services/demo/schema';
import { createServiceClient } from '@/lib/supabase/service';
import { log } from '@/lib/log';

/**
 * Gates a new public demo session (docs: "try it for your business" plan,
 * Phase B). Called once, right before chat unlocks (email-capture submit) —
 * NOT per message. No tenant, no chat DB writes; just an IP-keyed counter,
 * plus a best-effort `demo_leads` row so a trial isn't left with zero record
 * (the [OPUS]-flagged gap from Phase B — RLS mirrors webhook_events: platform-
 * admin read-only, service-role write, see migration 0026).
 */
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await checkRateLimit(`demo:${ip}`, DEMO_SESSION_RATE_LIMIT);
  if (!rl.allowed) {
    return new Response(JSON.stringify({ allowed: false, remaining: rl.remaining }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const parsed = demoLeadRequestSchema.safeParse(await req.json().catch(() => null));
  if (parsed.success) {
    const { email, demoTenant } = parsed.data;
    try {
      const svc = createServiceClient();
      await svc.from('demo_leads').insert({
        email,
        business_name: demoTenant.businessName,
        business_type: demoTenant.businessType,
        intake_snapshot: demoTenant,
      });
    } catch (err) {
      // Lead capture is a courtesy write — never block the demo over it.
      log.error('[demo/start] failed to record demo_leads row', err);
    }
  }

  return new Response(JSON.stringify({ allowed: true, remaining: rl.remaining }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
