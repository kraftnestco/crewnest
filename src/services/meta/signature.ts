/**
 * Verify Meta's X-Hub-Signature-256 over the RAW request body.
 * Uses Web Crypto (available on both Node and Edge runtimes), so this module is
 * runtime-agnostic. See docs/02-SECURITY.md §5 and docs/06-INTEGRATIONS.md §1.2.
 *
 * IMPORTANT: pass the exact raw body bytes/string (do NOT JSON.parse first) —
 * the HMAC is computed over the exact bytes Meta sent.
 */

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Constant-time string comparison (avoids timing side-channels). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!signatureHeader) return false;

  // Header format: "sha256=<hexdigest>"
  const [algo, provided] = signatureHeader.split('=');
  if (algo !== 'sha256' || !provided) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = hex(mac);

  return timingSafeEqual(expected, provided);
}
