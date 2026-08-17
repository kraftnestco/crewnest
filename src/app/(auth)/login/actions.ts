'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { log } from '@/lib/log';

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
 * this can't be used to enumerate accounts. Sends a typed code ({{ .Token }}
 * in the Supabase "Reset Password" template) rather than a link — a link
 * sitting in an inbox gets pre-fetched and consumed by email security
 * scanners before the real user clicks it, which is indistinguishable from
 * the code having "expired instantly".
 */
export async function requestPasswordResetAction(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!email) return { error: 'Email is required.', sent: false };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email);

  // GoTrue itself doesn't reveal whether the email exists (it "succeeds" either
  // way); only report an error for genuine failures (rate limit, bad config).
  if (error) {
    return { error: 'Something went wrong sending the code. Please try again shortly.', sent: false };
  }

  return { error: null, sent: true };
}

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const rawRedirect = String(formData.get('redirect') ?? '');
  // `//host` is scheme-relative — browsers treat it as an external redirect, so a
  // bare `startsWith('/')` check alone is an open redirect. No explicit target
  // (e.g. arriving at bare /login after signing out) is not the same as "wants
  // admin" — that used to default to /admin and produced a wrong-account-type
  // rejection for a client re-logging in with no destination in mind.
  const explicitRedirect =
    rawRedirect && rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : null;

  if (!email || !password) {
    return { error: 'Email and password are required.' };
  }

  const supabase = await createSupabaseServerClient();
  const { data: signIn, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: 'Invalid email or password.' };
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('is_platform_admin')
    .eq('id', signIn.user?.id ?? '')
    .single();

  // Don't let a failed lookup read as "confirmed not an admin" — that produces a
  // specific, wrong-sounding rejection for what's actually a DB/lookup error.
  if (profileError) {
    log.error('[auth] signInAction profile lookup failed', {
      userId: signIn.user?.id,
      error: profileError.message,
    });
    await supabase.auth.signOut();
    return { error: 'Something went wrong verifying your account. Please try again.' };
  }
  const isAdmin = profile?.is_platform_admin ?? false;

  // Keep the two login entry points separate: an agency-admin credential must not
  // complete a client login, nor a client credential an admin login — even though
  // both authenticate identically. The layout guards already prevent cross-access,
  // but rejecting here (rather than signing in then bouncing) is what the entry
  // points imply. This only applies when a destination was actually requested —
  // a bare /login has no intent to enforce, so it just routes to whichever
  // portal this account actually has.
  //
  // Wrong-portal failures use the same copy as a bad password so the form never
  // discloses whether an email is an agency or client account.
  const wantsAdmin = explicitRedirect?.startsWith('/admin') ?? false;
  const wantsClient = explicitRedirect?.startsWith('/dashboard') ?? false;

  if ((wantsAdmin && !isAdmin) || (wantsClient && isAdmin)) {
    await supabase.auth.signOut();
    return { error: 'Invalid email or password.' };
  }

  redirect(explicitRedirect ?? (isAdmin ? '/admin' : '/dashboard'));
}
