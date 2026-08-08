'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { signInAction, requestPasswordResetAction, type SignInState, type ForgotPasswordState } from './actions';
import { VerifyCodeForm } from './verify-code-form';

const initialState: SignInState = { error: null };
const initialForgotState: ForgotPasswordState = { error: null, sent: false };

export function LoginForm({ redirectTo }: { redirectTo: string }) {
  const [state, formAction, isPending] = useActionState(signInAction, initialState);
  const [forgotState, forgotAction, forgotPending] = useActionState(requestPasswordResetAction, initialForgotState);
  const [mode, setMode] = useState<'sign-in' | 'forgot' | 'invite'>('sign-in');
  const [forgotEmail, setForgotEmail] = useState('');
  // Tracks whether to show the code-entry step, separately from
  // forgotState.sent — that flag never resets once true, which would
  // otherwise strand the user on the code screen with no way to request a
  // fresh one (e.g. after the first code expires or they left and came back).
  const [codeRequested, setCodeRequested] = useState(false);
  const [handledForgotState, setHandledForgotState] = useState(forgotState);
  const [supabase] = useState(() => createSupabaseBrowserClient());
  const [googlePending, setGooglePending] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  async function handleGoogle() {
    setGoogleError(null);
    setGooglePending(true);
    // `next` tells /auth/callback this is a returning sign-in, not a fresh
    // signup — see that route for why the distinction matters. Falls back to
    // /dashboard so a bare "/login" (no ?redirect=) still lands somewhere.
    const next = encodeURIComponent(redirectTo || '/dashboard');
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${next}` },
    });
    if (oauthError) {
      setGoogleError(oauthError.message);
      setGooglePending(false);
    }
    // On success the browser navigates away to Google — nothing more to do here.
  }

  if (forgotState !== handledForgotState) {
    setHandledForgotState(forgotState);
    if (forgotState.sent) setCodeRequested(true);
  }

  function backToSignIn() {
    setMode('sign-in');
    setCodeRequested(false);
  }

  if (mode === 'forgot') {
    if (codeRequested) {
      return <VerifyCodeForm type="recovery" email={forgotEmail} redirectTo={redirectTo} onBack={backToSignIn} />;
    }

    return (
      <form action={forgotAction} className="flex flex-col gap-4">
        <input type="hidden" name="redirect" value={redirectTo} />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="forgot-email">Email</Label>
          <Input
            id="forgot-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="h-11"
            value={forgotEmail}
            onChange={(e) => setForgotEmail(e.target.value)}
          />
        </div>
        {forgotState.error && <p className="text-sm text-destructive">{forgotState.error}</p>}
        <Button type="submit" disabled={forgotPending} className="mt-2 h-11">
          {forgotPending ? 'Sending…' : 'Send code'}
        </Button>

        <button
          type="button"
          onClick={backToSignIn}
          className="text-sm text-muted-foreground underline underline-offset-2"
        >
          Back to sign in
        </button>
      </form>
    );
  }

  if (mode === 'invite') {
    return (
      <VerifyCodeForm type="invite" email="" redirectTo="/dashboard" onBack={() => setMode('sign-in')} />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="redirect" value={redirectTo} />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required className="h-11" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required className="h-11" />
        </div>

        {state.error && <p className="text-sm text-destructive">{state.error}</p>}

        <Button type="submit" disabled={isPending} className="mt-2 h-11">
          {isPending ? 'Signing in…' : 'Sign in'}
        </Button>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setMode('invite')}
            className="text-sm text-muted-foreground underline underline-offset-2"
          >
            Have an invite code?
          </button>
          <button
            type="button"
            onClick={() => setMode('forgot')}
            className="text-sm text-muted-foreground underline underline-offset-2"
          >
            Forgot password?
          </button>
        </div>
      </form>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        or
        <div className="h-px flex-1 bg-border" />
      </div>

      {googleError && <p className="text-sm text-destructive">{googleError}</p>}

      <Button type="button" variant="outline" onClick={handleGoogle} disabled={googlePending} className="h-11">
        {googlePending ? 'Redirecting…' : 'Continue with Google'}
      </Button>
    </div>
  );
}
