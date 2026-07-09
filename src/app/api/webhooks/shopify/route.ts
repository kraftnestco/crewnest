import { type NextRequest } from 'next/server';

/**
 * Shopify webhook — PHASE 2 STUB. See docs/06-INTEGRATIONS.md §3.
 * When implemented: verify base64 X-Shopify-Hmac-Sha256 over the RAW body with
 * the app secret, then patch tenants.catalog_data for the matching store.
 */
export const runtime = 'nodejs';

export async function POST(_req: NextRequest) {
  return new Response('Not Implemented (Phase 2)', { status: 501 });
}
