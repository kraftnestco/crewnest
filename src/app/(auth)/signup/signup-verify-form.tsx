'use client';

import { useState, type FormEvent } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Finishes self-serve signup with the typed code from the "Confirm signup"
 * email — no password re-entry needed, since it was already set at signUp
 * time (unlike VerifyCodeForm's invite/recovery flows, which verify THEN set
 * a first/new password).
 */
export function SignupVerifyForm({ email, onBack }: { email: string; onBack: () => void }) {
  const [supabase] = useState(() => createSupabaseBrowserClient());
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: 'signup',
    });

    setPending(false);
    if (verifyError) {
      setError('That code is invalid or has expired. Double-check it, or go back and try again.');
      return;
    }

    // Hard navigation so the server re-reads the just-written session cookies.
    window.location.assign('/signup/complete');
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        We sent a code to {email}. Enter it below to finish creating your account.
      </p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-verify-code">Code from your email</Label>
        <Input
          id="signup-verify-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={pending} className="mt-2">
        {pending ? 'Verifying…' : 'Verify & continue'}
      </Button>

      <button type="button" onClick={onBack} className="text-sm text-muted-foreground underline underline-offset-2">
        Back
      </button>
    </form>
  );
}
