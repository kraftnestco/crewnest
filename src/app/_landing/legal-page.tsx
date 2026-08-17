import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Logomark } from './logomark';

/**
 * Shared shell for the static legal pages (/privacy, /terms) — Phase U3.
 * These pages are required for Meta App Review, so they must stay reachable
 * from the public footer and render without auth.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-6 py-3">
          <Link href="/" className="flex items-center gap-2">
            <Logomark />
            <span className="font-logo text-lg">ClerkNest</span>
          </Link>
          <Link href="/" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
            Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-14">
        <h1 className={cn('font-hero-display', 'text-3xl tracking-tight')}>{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {updated}</p>
        <div className="mt-8 flex flex-col gap-6 text-sm leading-relaxed text-foreground/85 [&_h2]:font-heading [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:pl-5">
          {children}
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-3 px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:justify-between">
          <p>© {new Date().getFullYear()} ClerkNest</p>
          <div className="flex gap-4">
            <Link href="/security" className="hover:text-foreground">
              Security
            </Link>
            <Link href="/privacy" className="hover:text-foreground">
              Privacy policy
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terms of service
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
