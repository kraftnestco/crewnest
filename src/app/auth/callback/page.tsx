'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Status = 'verifying' | 'set-password' | 'error';

/**
 * Completes Supabase's admin-issued links (invite, magic link, recovery).
 * Those are generated server-side (no browser code_verifier exists), so
 * GoTrue appends tokens as a URL *fragment* (#access_token=...) rather than a
 * `?code=` param — fragments never reach the server, so this has to run
 * client-side. See docs/13 §9 (inviteClientLoginAction) for the sender side.
 */
export default function AuthCallbackPage() {
  const [status, setStatus] = useState<Status>('verifying');
  const [error, setError] = useState<string | null>(null);
  const [next, setNext] = useState('/dashboard');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');
    const linkType = hashParams.get('type');

    const nextRaw = new URLSearchParams(window.location.search).get('next');
    const resolvedNext = nextRaw && nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/dashboard';
    setNext(resolvedNext);

    if (!accessToken || !refreshToken) {
      setError('This link is invalid or has expired.');
      setStatus('error');
      return;
    }

    const supabase = createSupabaseBrowserClient();
    supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error: sessionError }) => {
      if (sessionError) {
        setError('This link is invalid or has expired.');
        setStatus('error');
        return;
      }

      // Invite/recovery links sign the user in via a one-time token but never
      // gave them a password of their own — send them through a set-password
      // step instead of straight into the app. Magic links have no password to
      // set, so those keep going straight in.
      if (linkType === 'invite' || linkType === 'recovery') {
        setStatus('set-password');
        return;
      }

      // A hard navigation, not router.replace(): the new session was just
      // written to cookies, but Next's client Router Cache can still serve a
      // stale RSC response for `next` from a session that was active earlier
      // in this same tab (e.g. an admin who was signed in before a client
      // clicked their invite link) — a full page load guarantees the server
      // re-reads the real cookies.
      window.location.assign(resolvedNext);
    });
  }, []);

  async function handleSetPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSaving(true);
    const supabase = createSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    // Same hard-navigation reasoning as above — this is the same tab that may
    // have held a different account's session before the invite link was clicked.
    window.location.assign(next);
  }

  if (status === 'set-password') {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-xl bg-card p-6 ring-1 ring-foreground/10">
          <div className="mb-6">
            <h1 className="font-heading text-lg font-semibold">Set your password</h1>
            <p className="text-sm text-muted-foreground">Choose a password to finish setting up your account.</p>
          </div>
          <form onSubmit={handleSetPassword} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={saving} className="mt-2">
              {saving ? 'Saving…' : 'Set password & continue'}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="text-center">
        {status === 'error' ? (
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
