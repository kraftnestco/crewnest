import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next.js 16 "Proxy" (formerly Middleware). OPTIMISTIC auth redirect ONLY.
 *
 * ⚠️ This is NOT the security boundary. Per the Next 16 docs, proxy must not be
 * used for session/authorization. The REAL gate is server-side in
 * app/admin/layout.tsx via supabase.auth.getUser() + role check
 * (docs/02-SECURITY.md §3). Here we only bounce obviously-unauthenticated
 * requests to /login to avoid rendering the dashboard shell.
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies
    .getAll()
    .some((c) => c.name.startsWith('sb-') && c.name.includes('auth-token'));

  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Only guard the dashboard. Public routes, API webhooks, and the widget are unaffected.
  matcher: ['/admin/:path*'],
};
