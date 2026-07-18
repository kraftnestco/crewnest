'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';

export interface SignInState {
  error: string | null;
}

export interface ForgotPasswordState {
  error: string | null;
  sent: boolean;
}

/**
 * Self-serve password reset, triggered by the account holder themselves from
 * the login page — not by an admin on their behalf (see invite/actions.ts).
 * Always reports success regardless of whether the email is registered, so
 * this can't be used to enumerate accounts.
 */
export async function requestPasswordResetAction(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!email) return { error: 'Email is required.', sent: false };

  const redirectRaw = String(formData.get('redirect') ?? '/dashboard');
  const next = redirectRaw.startsWith('/') && !redirectRaw.startsWith('//') ? redirectRaw : '/dashboard';

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(next)}`,
  });

  // GoTrue itself doesn't reveal whether the email exists (it "succeeds" either
  // way); only report an error for genuine failures (rate limit, bad config).
  if (error) {
    return { error: 'Something went wrong sending the reset link. Please try again shortly.', sent: false };
  }

  return { error: null, sent: true };
}

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const redirectTo = String(formData.get('redirect') ?? '/admin');

  if (!email || !password) {
    return { error: 'Email and password are required.' };
  }

  const supabase = await createSupabaseServerClient();
  const { data: signIn, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: 'Invalid email or password.' };
  }

  // Keep the two login entry points separate: an agency-admin credential must not
  // complete a client login, nor a client credential an admin login — even though
  // both authenticate identically. The layout guards already prevent cross-access,
  // but rejecting here (rather than signing in then bouncing) is what the entry
  // points imply. Role lives on profiles.is_platform_admin (see getCallerContext).
  const wantsAdmin = redirectTo.startsWith('/admin');
  const wantsClient = redirectTo.startsWith('/dashboard');
  if (wantsAdmin || wantsClient) {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('is_platform_admin')
      .eq('id', signIn.user?.id ?? '')
      .single();

    // Don't let a failed lookup read as "confirmed not an admin" — that produces a
    // specific, wrong-sounding rejection for what's actually a DB/lookup error.
    if (profileError) {
      console.error('[auth] signInAction profile lookup failed', {
        userId: signIn.user?.id,
        error: profileError.message,
      });
      await supabase.auth.signOut();
      return { error: 'Something went wrong verifying your account. Please try again.' };
    }
    const isAdmin = profile?.is_platform_admin ?? false;

    if (wantsAdmin && !isAdmin) {
      await supabase.auth.signOut();
      return { error: 'This isn’t an agency admin account. Use “Sign in as client” instead.' };
    }
    if (wantsClient && isAdmin) {
      await supabase.auth.signOut();
      return { error: 'This is an agency admin account. Use “Sign in as admin” instead.' };
    }
  }

  // `//host` is scheme-relative — browsers treat it as an external redirect, so
  // a bare `startsWith('/')` check alone is an open redirect.
  redirect(redirectTo.startsWith('/') && !redirectTo.startsWith('//') ? redirectTo : '/admin');
}
