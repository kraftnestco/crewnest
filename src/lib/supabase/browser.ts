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
  );
}
