import { redirect } from 'next/navigation';
import { getCallerContext } from '@/lib/auth/context';
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
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl bg-card p-6 ring-1 ring-foreground/10">
        <div className="mb-6">
          <h1 className="font-hero-display text-lg">CrewNest</h1>
          <p className="text-sm text-muted-foreground">
            {existingAccountEmail
              ? `Currently signed in as ${existingAccountEmail}. Sign in below to switch accounts.`
              : redirectTo?.startsWith('/dashboard')
                ? 'Sign in to your business dashboard.'
                : 'Sign in to the agency dashboard.'}
          </p>
        </div>
        <LoginForm redirectTo={redirectTo ?? ''} />
      </div>
    </div>
  );
}
