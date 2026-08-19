import { randomBytes } from 'node:crypto';
import { type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { log } from '@/lib/log';
import { createServiceClient } from '@/lib/supabase/service';
import { parseMetaSignedRequest } from '@/services/meta/signedRequest';

export const runtime = 'nodejs';

/**
 * Meta data-deletion callback (App Dashboard → Settings → Basic).
 * POST application/x-www-form-urlencoded with `signed_request`.
 * Must return { url, confirmation_code } — never tokens or PII besides the opaque code.
 */
export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? '';
  let signedRequest = '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const form = await req.formData();
    signedRequest = String(form.get('signed_request') ?? '');
  } else {
    const raw = await req.text();
    try {
      const json = JSON.parse(raw) as { signed_request?: string };
      signedRequest = json.signed_request ?? '';
    } catch {
      signedRequest = new URLSearchParams(raw).get('signed_request') ?? '';
    }
  }

  const payload = parseMetaSignedRequest(signedRequest, env.META_APP_SECRET);
  const facebookUserId = payload?.user_id;
  if (!facebookUserId) {
    return Response.json({ error: 'Invalid signed_request' }, { status: 400 });
  }

  const confirmationCode = randomBytes(16).toString('hex');
  const svc = createServiceClient();
  const { error } = await svc.from('meta_deletion_requests').insert({
    confirmation_code: confirmationCode,
    facebook_user_id: facebookUserId,
    status: 'received',
  });
  if (error) {
    log.error('[meta deletion] insert failed', { error: error.message });
    return Response.json({ error: 'Could not record request' }, { status: 500 });
  }

  const url = `${env.NEXT_PUBLIC_APP_URL}/privacy/data-deletion?code=${encodeURIComponent(confirmationCode)}`;
  return Response.json({ url, confirmation_code: confirmationCode });
}
