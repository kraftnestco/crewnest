import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCallerContext } from '@/lib/auth/context';
import { AuthShell } from '../auth-shell';
import { LoginForm } from './login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect: redirectTo } = await searchParams;
  const ctx = await getCallerContext();

  let existingAccountEmail: string | null = null;
  if (ctx) {
    const wantsAdmin = redirectTo?.startsWith('/admin');
    const wantsClient = redirectTo?.startsWith('/dashboard');
    const matchesIntent = wantsAdmin ? ctx.isPlatformAdmin : wantsClient ? !ctx.isPlatformAdmin : true;

    if (matchesIntent) {
      redirect(redirectTo ?? (ctx.isPlatformAdmin ? '/admin' : '/dashboard'));
    }
    // The existing session is the other kind of account (e.g. an admin session
    // lingering while "Sign in as client" was clicked) — don't honor it silently;
    // let the form below authenticate whichever account was actually intended.
    existingAccountEmail = ctx.email;
  }

  return (
    <AuthShell
      title="Sign in to CrewNest"
      description={
        existingAccountEmail
          ? `Currently signed in as ${existingAccountEmail}. Sign in below to switch accounts.`
          : redirectTo?.startsWith('/dashboard')
            ? 'Sign in to your business dashboard.'
            : 'Sign in to the agency dashboard.'
      }
      whatNext="Use the email your CrewNest setup was sent to."
      footer={
        // Agency admin accounts are invited, never self-serve — only offer the
        // signup link when this sign-in is headed for the client dashboard
        // (the same audience signup.tsx targets), mirroring its own reciprocal
        // "Already have an account? Sign in" link.
        !redirectTo?.startsWith('/admin') ? (
          <>
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="text-foreground underline underline-offset-2">
              Sign up
            </Link>
          </>
        ) : undefined
      }
    >
      <LoginForm redirectTo={redirectTo ?? ''} />
    </AuthShell>
  );
}
