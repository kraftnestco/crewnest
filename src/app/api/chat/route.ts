import { type NextRequest } from 'next/server';
import { handleInboundMessage } from '@/services/aiOrchestrator';
import * as tenants from '@/services/tenants';
import { checkRateLimit } from '@/services/security/rateLimit';

/**
 * Website chat widget endpoint. Least-privilege channel: authenticated by a
 * tenant PUBLIC key, origin-allowlisted, rate-limited. Runs the SAME orchestrator
 * but returns the reply in the HTTP response. See docs/06-INTEGRATIONS.md §2.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');

  let body: { key?: string; sessionKey?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400, origin);
  }

  const { key, sessionKey, text } = body;
  if (!key || !sessionKey || !text) {
    return json({ error: 'missing fields' }, 400, origin);
  }

  // Resolve tenant + enforce origin allowlist.
  const tenant = await tenants.resolveByWidgetKey(key);
  if (!tenant) return json({ error: 'unknown key' }, 403, origin);
  if (origin && tenant.widgetAllowedOrigins.length > 0 && !tenant.widgetAllowedOrigins.includes(origin)) {
    return json({ error: 'origin not allowed' }, 403, origin);
  }

  // Rate limit per (tenant, session).
  const rl = checkRateLimit(`${tenant.id}:${sessionKey}`);
  if (!rl.allowed) return json({ error: 'rate limited' }, 429, origin);

  try {
    const result = await handleInboundMessage({
      platform: 'web',
      destinationId: key,
      externalUserId: sessionKey,
      text,
    });
    return json({ reply: result?.replyText ?? null, handoff: result?.handoff ?? false }, 200, origin);
  } catch (err) {
    console.error('[widget] processing failed', {
      tenantId: tenant.id,
      error: err instanceof Error ? err.message : 'unknown',
    });
    return json({ error: 'internal error' }, 500, origin);
  }
}

// CORS preflight — scope to the requesting origin (allowlist enforced in POST).
export async function OPTIONS(req: NextRequest) {
  return json(null, 204, req.headers.get('origin'));
}

function json(payload: unknown, status: number, origin: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Vary'] = 'Origin';
  }
  return new Response(payload === null ? null : JSON.stringify(payload), { status, headers });
}
