import { NextResponse } from 'next/server';

export interface MetaPopupMessage {
  type: 'meta-connected' | 'whatsapp-connected';
  ok: boolean;
  error?: string;
  /** Success-path caveat, e.g. "Facebook connected, Instagram needs an upgrade." */
  note?: string;
}

/**
 * Closes the OAuth popup and posts a fixed-string result to the opener.
 * `message.error` must never include Meta/raw attacker text (inline script XSS).
 */
export function metaPopupResponse(message: MetaPopupMessage, cookieName: string, cookiePath: string): NextResponse {
  const html = `<!doctype html>
<html><body>
<script>
  if (window.opener) {
    window.opener.postMessage(${JSON.stringify(message)}, window.location.origin);
    window.close();
  } else {
    window.location.href = '/dashboard/business';
  }
</script>
<p>${message.ok ? 'Connected. You can close this window.' : 'Connection failed. You can close this window.'}</p>
</body></html>`;
  const res = new NextResponse(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
  res.cookies.set(cookieName, '', { path: cookiePath, maxAge: 0 });
  return res;
}
