import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';
import type { Database } from '@/types/database';

/**
 * RLS-scoped Supabase client for Server Components, Route Handlers, and Server
 * Actions. Bound to the signed-in user's session via cookies, so Postgres RLS
 * enforces tenant boundaries automatically.
 *
 * Next.js 16: `cookies()` is ASYNC — this factory must be awaited.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component render where cookies are read-only.
            // Safe to ignore: the proxy/route refresh path writes the cookies.
          }
        },
      },
    },
  );
}
