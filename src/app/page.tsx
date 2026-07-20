import Link from 'next/link';
import { MessagesSquare, Sparkles, PackageCheck, UserCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Logomark } from './_landing/logomark';
import { TiltCard } from './_landing/tilt-card';
import { HeroVisual } from './_landing/hero-visual';
import { displayFont } from './_landing/fonts';

const FEATURES = [
  {
    icon: MessagesSquare,
    title: 'One inbox, every channel',
    description: 'WhatsApp, Facebook & Instagram DMs, and website chat all land in a single live inbox.',
  },
  {
    icon: Sparkles,
    title: 'Grounded in your business',
    description: 'Replies pull from your actual catalogue and brand voice — never generic, off-the-shelf answers.',
  },
  {
    icon: PackageCheck,
    title: 'Orders captured automatically',
    description: 'Confirmed orders are logged and pushed straight to your WhatsApp — no manual data entry.',
  },
  {
    icon: UserCheck,
    title: 'Human handoff, anytime',
    description: 'Step into any conversation the moment it needs a human touch, then hand it back.',
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <Logomark />
            <span className={cn(displayFont.className, 'text-lg font-semibold')}>
              Crew<span className="font-normal text-muted-foreground">Nest</span>
            </span>
          </div>
          <nav className="flex items-center gap-1.5 sm:gap-2">
            <Link href="/try" className={cn(buttonVariants({ size: 'sm' }))}>
              Try it free
            </Link>
            <Link href="/login?redirect=/dashboard" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
              <span className="sm:hidden">Client</span>
              <span className="hidden sm:inline">Client login</span>
            </Link>
            <Link href="/login?redirect=/admin" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
              <span className="sm:hidden">Admin</span>
              <span className="hidden sm:inline">Admin login</span>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative isolate overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              backgroundImage: 'radial-gradient(circle, var(--border) 1px, transparent 1px)',
              backgroundSize: '28px 28px',
              maskImage: 'radial-gradient(ellipse 60% 50% at 50% 0%, black 40%, transparent 80%)',
              WebkitMaskImage: 'radial-gradient(ellipse 60% 50% at 50% 0%, black 40%, transparent 80%)',
            }}
          />

          <div className="mx-auto grid w-full max-w-5xl items-center gap-12 px-6 py-20 lg:grid-cols-[1.1fr_1fr] lg:py-28">
            <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
              <Badge variant="secondary">Multi-channel AI employee</Badge>
              <h1 className={cn(displayFont.className, 'mt-4 text-4xl tracking-tight text-balance sm:text-5xl')}>
                Your business, answered instantly.
              </h1>
              <p className="mt-4 max-w-xl text-lg text-muted-foreground text-balance">
                CrewNest gives your business an AI employee that answers customers across WhatsApp, Facebook,
                Instagram, and your website — grounded in your catalogue, with a human always one tap away.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/try" className={cn(buttonVariants({ size: 'lg' }), 'w-full sm:w-auto')}>
                  Try it for your business — free
                </Link>
                <Link
                  href="/login?redirect=/dashboard"
                  className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'w-full sm:w-auto')}
                >
                  Sign in as client
                </Link>
              </div>
            </div>

            <HeroVisual />
          </div>
        </section>

        <section id="features" className="mx-auto w-full max-w-5xl px-6 pb-24">
          <div className="grid gap-4 sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <TiltCard key={feature.title} max={5}>
                <Card className="h-full">
                  <CardHeader>
                    <span className="inline-flex size-9 items-center justify-center rounded-xl bg-foreground text-background shadow-sm">
                      <feature.icon className="size-4" />
                    </span>
                    <CardTitle className={cn(displayFont.className, 'mt-2 font-semibold')}>{feature.title}</CardTitle>
                    <CardDescription>{feature.description}</CardDescription>
                  </CardHeader>
                  <CardContent />
                </Card>
              </TiltCard>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-3 px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2">
            <Logomark className="size-6" />
            <p>© {new Date().getFullYear()} CrewNest</p>
          </div>
          <div className="flex gap-4">
            <Link href="/login?redirect=/dashboard" className="hover:text-foreground">
              Client login
            </Link>
            <Link href="/login?redirect=/admin" className="hover:text-foreground">
              Admin login
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
