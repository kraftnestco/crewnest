'use client';

import { useState, type FormEvent } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PAYWALL_PLANS } from '@/services/demo/plans';
import { SignupVerifyForm } from './signup-verify-form';

/**
 * Self-serve signup (docs: "try it for your business" plan, Phase C) — the
 * first non-invite auth entry point in the app. Mirrors verify-code-form.tsx's
 * typed-code pattern (never a clickable link): `supabase.auth.signUp` sends a
 * code via the Supabase "Confirm signup" template, which must be configured
 * with `{{ .Token }}` the same way Invite/Recovery already are.
 */
export function SignupForm({ initialEmail, planId }: { initialEmail: string; planId: string }) {
  const [supabase] = useState(() => createSupabaseBrowserClient());
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const [awaitingCode, setAwaitingCode] = useState(false);

  const plan = PAYWALL_PLANS.find((p) => p.id === planId);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
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

    setPending(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
    });
    setPending(false);

    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    if (data.session) {
      // Email confirmations are off for this project — the session is live already.
      window.location.assign('/signup/complete');
      return;
    }

    setAwaitingCode(true);
  }

  async function handleGoogle() {
    setError(null);
    setGooglePending(true);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (oauthError) {
      setError(oauthError.message);
      setGooglePending(false);
    }
    // On success the browser navigates away to Google — nothing more to do here.
  }

  if (awaitingCode) {
    return <SignupVerifyForm email={email.trim().toLowerCase()} onBack={() => setAwaitingCode(false)} />;
  }

  return (
    <div className="flex flex-col gap-3">
      {plan && (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          You selected the <span className="font-medium text-foreground">{plan.name}</span> plan ({plan.price}).
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signup-email">Email</Label>
          <Input
            id="signup-email"
            type="email"
            autoComplete="email"
            required
            className="h-10"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signup-password">Password</Label>
          <Input
            id="signup-password"
            type="password"
            autoComplete="new-password"
            required
            className="h-10"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signup-confirm-password">Confirm password</Label>
          <Input
            id="signup-confirm-password"
            type="password"
            autoComplete="new-password"
            required
            className="h-10"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={pending} className="mt-1 h-10">
          {pending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        or
        <div className="h-px flex-1 bg-border" />
      </div>

      <Button type="button" variant="outline" onClick={handleGoogle} disabled={googlePending} className="h-10">
        {googlePending ? 'Redirecting…' : 'Continue with Google'}
      </Button>
    </div>
  );
}
