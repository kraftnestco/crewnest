import { redirect } from 'next/navigation';
import { getCallerContext } from '@/lib/auth/context';
import { Button } from '@/components/ui/button';
import { AppTopbar } from '@/components/app-topbar';
import { TopbarHeadingProvider } from '@/components/topbar-heading';
import { Logomark } from '@/app/_landing/logomark';
import { signOutAction } from './actions';
import { AdminNav, AdminTabBar } from './admin-nav';

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
          <h1 className="font-hero-display text-lg">Access pending</h1>
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
    <TopbarHeadingProvider>
      {/* h-dvh + overflow-hidden, not min-h-screen — a 100vh outer box is
          taller than the visible viewport while the URL bar shows, which made
          the whole document scroll and lifted the tab bar. See the client
          dashboard layout. */}
      <div className="flex h-dvh overflow-hidden">
        {/* Desktop sidebar — hidden below lg; phones use the bottom tab bar instead. */}
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
          <div className="flex items-center gap-3 p-4">
            <Logomark className="size-8" />
            <div className="min-w-0">
              <p className="font-logo text-2xl leading-none">CrewNest</p>
              <p className="mt-1 truncate text-[0.7rem] text-muted-foreground">By KraftNest Automations</p>
            </div>
          </div>
          {/* Account-type indicator — the admin (/admin) and client (/dashboard)
              shells otherwise look identical (same logo, same topbar component),
              so this is the only always-visible cue for which one you're in. */}
          <div className="px-4 pb-3">
            <span className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[0.65rem] font-medium text-primary">
              Agency
            </span>
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
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <AppTopbar accountHref="/admin/account" accountTypeLabel="Agency" accountKind="agency" />
          {/* See the client dashboard layout for why overscroll-contain /
              touch-pan-y are here — same fix for the same mobile scroll trap. */}
          {/* min-w-0 + overflow-x-hidden — see the client dashboard layout for
              why (a wide table must not widen the page itself). */}
          {/* No bottom padding — the tab bar is a flex sibling that reserves
              its own height. See the client dashboard layout. */}
          <main className="min-h-0 min-w-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain">
            {children}
          </main>
          <AdminTabBar />
        </div>
      </div>
    </TopbarHeadingProvider>
  );
}
