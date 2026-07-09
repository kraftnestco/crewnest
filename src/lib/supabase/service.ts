import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import type { Database } from '@/types/database';

/**
 * SERVICE-ROLE client. BYPASSES Row Level Security.
 *
 * ⚠️ SECURITY: use ONLY in trusted server contexts — webhook handlers and their
 * after() callbacks, and server-only services (tenant resolution, secret reads,
 * AI-authored writes). The `import 'server-only'` above makes importing this
 * from a Client Component a build error. Never expose the service key or any
 * value it can decrypt to the browser. See docs/02-SECURITY.md §4.
 */
export function createServiceClient() {
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
