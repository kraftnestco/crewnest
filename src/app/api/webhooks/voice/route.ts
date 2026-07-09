import { type NextRequest } from 'next/server';

/**
 * Voice / SIP webhook — PHASE 3 STUB. See docs/06-INTEGRATIONS.md §4.
 * When implemented: accept SIP-trunk transcripts, route via aiOrchestrator with
 * platform='voice' (resolved by sip_trunk_id), return audio/text instructions.
 */
export const runtime = 'nodejs';

export async function POST(_req: NextRequest) {
  return new Response('Not Implemented (Phase 3)', { status: 501 });
}
