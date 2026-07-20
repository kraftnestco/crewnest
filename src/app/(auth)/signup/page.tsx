import Link from 'next/link';
import { SignupForm } from './signup-form';

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; email?: string }>;
}) {
  const { plan, email } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl bg-card p-6 ring-1 ring-foreground/10">
        <div className="mb-6">
          <h1 className="font-heading text-lg font-semibold">Create your account</h1>
          <p className="text-sm text-muted-foreground">
            We&apos;ll set up your AI employee from what you just built in the demo.
          </p>
        </div>
        <SignupForm initialEmail={email ?? ''} planId={plan ?? 'free'} />
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login?redirect=/dashboard" className="text-foreground underline underline-offset-2">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
