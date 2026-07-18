'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signInAction, requestPasswordResetAction, type SignInState, type ForgotPasswordState } from './actions';
import { VerifyCodeForm } from './verify-code-form';

const initialState: SignInState = { error: null };
const initialForgotState: ForgotPasswordState = { error: null, sent: false };

export function LoginForm({ redirectTo }: { redirectTo: string }) {
  const [state, formAction, isPending] = useActionState(signInAction, initialState);
  const [forgotState, forgotAction, forgotPending] = useActionState(requestPasswordResetAction, initialForgotState);
  const [mode, setMode] = useState<'sign-in' | 'forgot' | 'invite'>('sign-in');
  const [forgotEmail, setForgotEmail] = useState('');

  if (mode === 'forgot') {
    if (forgotState.sent) {
      return (
        <VerifyCodeForm
          type="recovery"
          email={forgotEmail}
          redirectTo={redirectTo}
          onBack={() => setMode('sign-in')}
        />
      );
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
            value={forgotEmail}
            onChange={(e) => setForgotEmail(e.target.value)}
          />
        </div>
        {forgotState.error && <p className="text-sm text-destructive">{forgotState.error}</p>}
        <Button type="submit" disabled={forgotPending} className="mt-2">
          {forgotPending ? 'Sending…' : 'Send code'}
        </Button>

        <button
          type="button"
          onClick={() => setMode('sign-in')}
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
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="redirect" value={redirectTo} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" disabled={isPending} className="mt-2">
        {isPending ? 'Signing in…' : 'Sign in'}
      </Button>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMode('forgot')}
          className="text-sm text-muted-foreground underline underline-offset-2"
        >
          Forgot password?
        </button>
        <button
          type="button"
          onClick={() => setMode('invite')}
          className="text-sm text-muted-foreground underline underline-offset-2"
        >
          Have an invite code?
        </button>
      </div>
    </form>
  );
}
