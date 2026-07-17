'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

/**
 * Completes Supabase's admin-issued links (invite, magic link, recovery).
 * Those are generated server-side (no browser code_verifier exists), so
 * GoTrue appends tokens as a URL *fragment* (#access_token=...) rather than a
 * `?code=` param — fragments never reach the server, so this has to run
 * client-side. See docs/13 §9 (inviteClientLoginAction) for the sender side.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');

    const nextRaw = new URLSearchParams(window.location.search).get('next');
    const next = nextRaw && nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/dashboard';

    if (!accessToken || !refreshToken) {
      setError('This link is invalid or has expired.');
      return;
    }

    const supabase = createSupabaseBrowserClient();
    supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error: sessionError }) => {
      if (sessionError) {
        setError('This link is invalid or has expired.');
        return;
      }
      router.replace(next);
    });
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="text-center">
        {error ? (
          <>
            <p className="text-sm text-destructive">{error}</p>
            <a href="/login" className="mt-2 inline-block text-sm underline underline-offset-2">
              Back to login
            </a>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Signing you in…</p>
        )}
      </div>
    </div>
  );
}
