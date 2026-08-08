import Link from 'next/link';
import { AuthShell } from '../auth-shell';
import { SignupForm } from './signup-form';

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; email?: string }>;
}) {
  const { plan, email } = await searchParams;

  return (
    <AuthShell
      title="Create your CrewNest account"
      description="We'll set up your AI employee from what you just built in the demo."
      whatNext="We'll email you a short code to confirm your account — no link to click, just type it in."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login?redirect=/dashboard" className="text-foreground underline underline-offset-2">
            Sign in
          </Link>
        </>
      }
    >
      <SignupForm initialEmail={email ?? ''} planId={plan ?? 'free'} />
    </AuthShell>
  );
}
