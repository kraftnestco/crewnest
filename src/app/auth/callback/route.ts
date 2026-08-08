import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Google OAuth landing point — shared by both signup-form.tsx and
 * login-form.tsx's "Continue with Google" buttons (docs: "try it for your
 * business" plan, Phase C, extended to login so Google-signup users have a
 * way back in). Exchanges the auth code for a session, then:
 *  - signup's button omits `next` -> falls through to /signup/complete,
 *    which reads the demo handoff out of sessionStorage and provisions the
 *    tenant (a returning user with no handoff in storage just sees a "you're
 *    signed in" screen there, so this default is still safe for them).
 *  - login's button sets `next` to wherever it was headed (its own
 *    `redirectTo` prop) -> skip the provisioning screen entirely and land
 *    straight there, the same as a password sign-in would.
 * `next` is same-origin-only (must start with a single `/`) — it round-trips
 * through Google's redirect, so treat it as attacker-controllable input and
 * never forward it as an absolute/protocol-relative URL.
 * ⚠️ User task: enable the Google provider (client id/secret) and add this
 * route's full URL to the allowed redirect URLs in the Supabase dashboard.
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next');

  if (code) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  const destination = next && next.startsWith('/') && !next.startsWith('//') ? next : '/signup/complete';
  return NextResponse.redirect(`${origin}${destination}`);
}
