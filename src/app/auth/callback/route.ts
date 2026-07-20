import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Google OAuth landing point (docs: "try it for your business" plan, Phase C).
 * Exchanges the auth code for a session, then hands off to /signup/complete,
 * which reads the demo handoff out of sessionStorage and provisions the tenant.
 * ⚠️ User task: enable the Google provider (client id/secret) and add this
 * route's full URL to the allowed redirect URLs in the Supabase dashboard.
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get('code');

  if (code) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}/signup/complete`);
}
