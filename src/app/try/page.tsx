import Link from 'next/link';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { Logomark } from '@/app/_landing/logomark';
import { TryDemo } from '@/components/demo/try-demo';

export const metadata = {
  title: 'Try ClerkNest for your business',
  description: 'Answer a few questions about your business and chat with your own AI employee. Free, no signup.',
};

export default function TryPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <Logomark />
            <span className="font-logo text-lg">ClerkNest</span>
          </Link>
          <Link href="/login?redirect=/dashboard" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6">
        <div className="mb-8 text-center">
          <h1 className={cn('font-hero-display', 'text-3xl tracking-tight text-balance sm:text-4xl')}>
            See your AI employee in action
          </h1>
          <p className="mt-2 text-muted-foreground text-balance">
            Answer a few quick questions about your business, then chat with the AI it generates. Free, no signup.
          </p>
        </div>
        <TryDemo />
      </main>
    </div>
  );
}
