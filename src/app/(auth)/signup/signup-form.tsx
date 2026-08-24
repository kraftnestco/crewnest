'use client';

import { useState, type FormEvent } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PAYWALL_PLANS } from '@/services/demo/plans';
import { SignupVerifyForm } from './signup-verify-form';
import { BILLING_COUNTRY_KEY, DEMO_HANDOFF_KEY, type DemoHandoff } from '@/services/demo/handoff';
import { SIGNUP_COUNTRY_OPTIONS, normalizeBillingCountry } from '@/lib/signup-country';

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
  const [country, setCountry] = useState('PK');

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

    const billingCountry = normalizeBillingCountry(country);
    if (!billingCountry) {
      setError('Select the country you operate in.');
      return;
    }
    persistBillingCountry(billingCountry);

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

    // Supabase silently returns an obfuscated user (never an error) for an
    // email that's already registered AND confirmed — a deliberate anti-
    // enumeration choice, but it means we can't rely on `signUpError` to
    // catch it. The one reliable tell: `identities` comes back empty only
    // for this exact case (a genuinely new signup always has one). Without
    // this check the form fell through to "check your email for a code" for
    // an email that was never going to receive one.
    if (data.user?.identities?.length === 0) {
      setError('That email is already registered. Try signing in instead, or use "Forgot password" on the sign-in page.');
      return;
    }

    if (data.session) {
      // Email confirmations are off for this project — the session is live already.
      window.location.assign('/signup/complete');
      return;
    }

    setAwaitingCode(true);
  }

  function persistBillingCountry(billingCountry: string) {
    sessionStorage.setItem(BILLING_COUNTRY_KEY, billingCountry);
    try {
      const raw = sessionStorage.getItem(DEMO_HANDOFF_KEY);
      if (!raw) return;
      const handoff = JSON.parse(raw) as DemoHandoff;
      sessionStorage.setItem(DEMO_HANDOFF_KEY, JSON.stringify({ ...handoff, billingCountry }));
    } catch {
      // Handoff is optional — Google-from-login still stores the country key above.
    }
  }

  async function handleGoogle() {
    setError(null);
    const billingCountry = normalizeBillingCountry(country);
    if (!billingCountry) {
      setError('Select the country you operate in.');
      return;
    }
    persistBillingCountry(billingCountry);
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

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signup-country">Country</Label>
          <select
            id="signup-country"
            required
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          >
            {SIGNUP_COUNTRY_OPTIONS.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Pakistan bills through Safepay. Everywhere else uses Stripe once checkout is live.
          </p>
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
