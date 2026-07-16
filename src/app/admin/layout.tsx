import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { signOutAction } from './actions';
import { AdminNav } from './admin-nav';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, full_name, is_platform_admin')
    .eq('id', userData.user.id)
    .single();

  if (!profile?.is_platform_admin) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-xl bg-card p-6 text-center ring-1 ring-foreground/10">
          <h1 className="font-heading text-lg font-semibold">Access pending</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your account isn&apos;t authorized for the CrewNest dashboard yet. Ask a platform admin to
            grant access.
          </p>
          <form action={signOutAction} className="mt-4">
            <Button type="submit" variant="outline" className="w-full">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="p-4">
          <p className="font-heading text-sm font-semibold">CrewNest</p>
        </div>
        <AdminNav />
        <div className="border-t border-sidebar-border p-3">
          <p className="truncate px-1 text-xs text-muted-foreground">
            {profile.full_name || profile.email}
          </p>
          <form action={signOutAction} className="mt-2">
            <Button type="submit" variant="outline" size="sm" className="w-full">
              Sign out
            </Button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
