'use client';

import { useState, type FormEvent } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Finishes an invite or password-reset started by email — the email carries
 * only a typed code ({{ .Token }}), never a clickable link, so a security
 * scanner visiting the inbox can't burn the one-time code before the real
 * user does.
 */
export function VerifyCodeForm({
  type,
  email: initialEmail,
  redirectTo,
  onBack,
}: {
  type: 'recovery' | 'invite';
  email: string;
  redirectTo: string;
  onBack: () => void;
}) {
  const [supabase] = useState(() => createSupabaseBrowserClient());
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type,
    });

    if (verifyError) {
      setError('That code is invalid or has expired. Double-check it, or request a new one.');
      setPending(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });
    setPending(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    // Hard navigation, not router.replace(): this tab may still hold a
    // different account's session from before the code was entered, and the
    // server needs to re-read the just-written cookies rather than serve a
    // stale Router Cache response.
    window.location.assign(redirectTo);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="verify-email">Email</Label>
        <Input
          id="verify-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="verify-code">Code from your email</Label>
        <Input
          id="verify-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="verify-password">New password</Label>
        <Input
          id="verify-password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="verify-confirm-password">Confirm password</Label>
        <Input
          id="verify-confirm-password"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={pending} className="mt-2">
        {pending ? 'Verifying…' : 'Set password & continue'}
      </Button>

      <button
        type="button"
        onClick={onBack}
        className="text-sm text-muted-foreground underline underline-offset-2"
      >
        Back to sign in
      </button>
    </form>
  );
}
