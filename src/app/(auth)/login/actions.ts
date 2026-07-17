'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface SignInState {
  error: string | null;
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
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_platform_admin')
      .eq('id', signIn.user?.id ?? '')
      .single();
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
