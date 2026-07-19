import { redirect } from 'next/navigation';
import { getCallerContext } from '@/lib/auth/context';
import { Button } from '@/components/ui/button';
import { AppTopbar } from '@/components/app-topbar';
import { signOutAction } from './actions';
import { AdminNav } from './admin-nav';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCallerContext();
  if (!ctx) {
    redirect('/login');
  }

  if (ctx.memberships.length > 0 && !ctx.isPlatformAdmin) {
    // A tenant-scoped client hit an agency URL — send them to their own dashboard.
    redirect('/dashboard');
  }

  if (!ctx.isPlatformAdmin) {
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
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="p-4">
          <p className="font-heading text-sm font-semibold">CrewNest</p>
        </div>
        <AdminNav />
        <div className="border-t border-sidebar-border p-3">
          <p className="truncate px-1 text-xs text-muted-foreground">{ctx.fullName || ctx.email}</p>
          <form action={signOutAction} className="mt-2">
            <Button type="submit" variant="outline" size="sm" className="w-full">
              Sign out
            </Button>
          </form>
        </div>
      </aside>
      <div className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
        <AppTopbar accountHref="/admin/account" />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
