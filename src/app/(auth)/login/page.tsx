import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { LoginForm } from './login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect: redirectTo } = await searchParams;

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    redirect(redirectTo ?? '/admin');
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl bg-card p-6 ring-1 ring-foreground/10">
        <div className="mb-6">
          <h1 className="font-heading text-lg font-semibold">CrewNest</h1>
          <p className="text-sm text-muted-foreground">Sign in to the agency dashboard.</p>
        </div>
        <LoginForm redirectTo={redirectTo ?? '/admin'} />
      </div>
    </div>
  );
}
