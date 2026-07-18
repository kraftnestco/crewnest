'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';

/**
 * Browser (anon) client for Client Components — used for Realtime subscriptions
 * in the Live Inbox. The anon key is public by design; RLS + Realtime's
 * postgres_changes authorization ensure a user only receives rows they may see.
 *
 * Reads NEXT_PUBLIC_* directly from process.env (do NOT import lib/env here —
 * that module is server-only).
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // We parse invite/recovery link fragments ourselves in auth/callback/page.tsx
      // and call setSession() explicitly. The default (true) makes every new client
      // instance re-parse the same still-present #access_token hash and silently
      // re-consume it — since Supabase rotates refresh tokens on use, that second,
      // automatic consumption races the manual one and can leave the manually-set
      // session invalidated by the time a later call (e.g. updateUser) runs against
      // a freshly created client, surfacing as "Auth session missing!".
      auth: { detectSessionInUrl: false },
    },
  );
}
