import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyMetaSignature } from './signature';

const APP_SECRET = 'test-app-secret';
const RAW_BODY = JSON.stringify({ object: 'page', entry: [{ id: '123', messaging: [] }] });

function sign(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('verifyMetaSignature', () => {
  it('accepts a correctly computed HMAC over the exact raw body', async () => {
    const header = sign(RAW_BODY, APP_SECRET);
    await expect(verifyMetaSignature(RAW_BODY, header, APP_SECRET)).resolves.toBe(true);
  });

  it('rejects a signature computed with the wrong secret', async () => {
    const header = sign(RAW_BODY, 'wrong-secret');
    await expect(verifyMetaSignature(RAW_BODY, header, APP_SECRET)).resolves.toBe(false);
  });

  it('rejects a signature computed over a different body (tamper detection)', async () => {
    const header = sign(RAW_BODY, APP_SECRET);
    await expect(verifyMetaSignature(RAW_BODY + 'x', header, APP_SECRET)).resolves.toBe(false);
  });

  it('rejects a missing header', async () => {
    await expect(verifyMetaSignature(RAW_BODY, null, APP_SECRET)).resolves.toBe(false);
  });

  it('rejects a header with the wrong algo prefix', async () => {
    const wrongAlgo = `sha1=${createHmac('sha256', APP_SECRET).update(RAW_BODY).digest('hex')}`;
    await expect(verifyMetaSignature(RAW_BODY, wrongAlgo, APP_SECRET)).resolves.toBe(false);
  });

  it('rejects a malformed header with no digest', async () => {
    await expect(verifyMetaSignature(RAW_BODY, 'sha256=', APP_SECRET)).resolves.toBe(false);
  });

  it('goes through the constant-time comparison path without throwing on mismatched lengths', async () => {
    await expect(verifyMetaSignature(RAW_BODY, 'sha256=abc', APP_SECRET)).resolves.toBe(false);
  });
});
