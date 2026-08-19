import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseMetaSignedRequest } from './signedRequest';

const SECRET = 'test-app-secret';

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function sign(payload: object): string {
  const encodedPayload = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = createHmac('sha256', SECRET).update(encodedPayload).digest();
  return `${b64url(sig)}.${encodedPayload}`;
}

describe('parseMetaSignedRequest', () => {
  it('accepts a valid HMAC-SHA256 signed_request and returns user_id', () => {
    const parsed = parseMetaSignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: 'fb-user-1' }), SECRET);
    expect(parsed?.user_id).toBe('fb-user-1');
  });

  it('rejects a signature minted with the wrong secret', () => {
    const forged = sign({ algorithm: 'HMAC-SHA256', user_id: 'fb-user-1' });
    expect(parseMetaSignedRequest(forged, 'other-secret')).toBeNull();
  });

  it('rejects a truncated or malformed value', () => {
    expect(parseMetaSignedRequest('not-a-signed-request', SECRET)).toBeNull();
    expect(parseMetaSignedRequest('', SECRET)).toBeNull();
  });
});
