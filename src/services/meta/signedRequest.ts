import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Meta `signed_request` (data-deletion / deauthorize callbacks).
 * Format: base64url(hmac_sha256(payload)) + '.' + base64url(json payload).
 * See https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 */

export interface MetaSignedRequestPayload {
  user_id?: string;
  algorithm?: string;
  issued_at?: number;
}

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, 'base64');
}

export function parseMetaSignedRequest(signedRequest: string, appSecret: string): MetaSignedRequestPayload | null {
  const dot = signedRequest.indexOf('.');
  if (dot <= 0) return null;
  const encodedSig = signedRequest.slice(0, dot);
  const encodedPayload = signedRequest.slice(dot + 1);
  if (!encodedPayload) return null;

  let sig: Buffer;
  let payloadBuf: Buffer;
  try {
    sig = base64UrlDecode(encodedSig);
    payloadBuf = base64UrlDecode(encodedPayload);
  } catch {
    return null;
  }

  const expected = createHmac('sha256', appSecret).update(encodedPayload).digest();
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;

  try {
    const parsed = JSON.parse(payloadBuf.toString('utf8')) as MetaSignedRequestPayload;
    if (parsed.algorithm && parsed.algorithm !== 'HMAC-SHA256') return null;
    return parsed;
  } catch {
    return null;
  }
}
