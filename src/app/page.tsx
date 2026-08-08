import Link from 'next/link';
import {
  MessagesSquare,
  Sparkles,
  PackageCheck,
  UserCheck,
  ClipboardList,
  Cable,
  Rocket,
  Check,
  ChevronDown,
  Menu,
  LogIn,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { PAYWALL_PLANS } from '@/services/demo/plans';
import { Logomark } from './_landing/logomark';
import { TiltCard } from './_landing/tilt-card';
import { HeroVisual } from './_landing/hero-visual';
import { displayFont } from './_landing/fonts';
import { PLATFORMS, PlatformBadge, type PlatformId } from './_landing/platform-icons';

const CHANNELS: PlatformId[] = ['whatsapp', 'instagram', 'messenger', 'web'];

/**
 * Single source for every in-page section link — the header's desktop nav,
 * its mobile hamburger menu, and the footer's Product column all render from
 * this instead of three independent literal lists that could silently drift
 * (docs/27 §3 M1/§4 M4 — Features had no nav entry at all before this).
 */
const SECTION_LINKS = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
] as const;

const STEPS = [
  {
    icon: ClipboardList,
    title: 'Tell us about your business',
    description:
      'Share your catalogue, hours, and how you like to talk to customers. That becomes the knowledge your AI employee answers from.',
  },
  {
    icon: Cable,
    title: 'We connect your channels',
    description:
      'WhatsApp, Instagram, Messenger, and your website get hooked up for you. No apps to configure, no technical work on your side.',
  },
  {
    icon: Rocket,
    title: 'Your AI starts working',
    description:
      'It answers customers, takes orders, and collects payments while you watch everything live and step in whenever you want.',
  },
];

const FEATURES = [
  {
    icon: MessagesSquare,
    title: 'One inbox, every channel',
    description: 'WhatsApp, Facebook & Instagram DMs, and website chat all land in a single live inbox.',
  },
  {
    icon: Sparkles,
    title: 'Grounded in your business',
    description: 'Every reply pulls from your actual catalogue and brand voice, never a generic script.',
  },
  {
    icon: PackageCheck,
    title: 'Orders captured automatically',
    description: 'Confirmed orders are logged and pushed straight to your WhatsApp, with no manual data entry.',
  },
  {
    icon: UserCheck,
    title: 'Human handoff, anytime',
    description: 'Step into any conversation the moment it needs a human touch, then hand it back.',
  },
];

const FAQS = [
  {
    q: 'Do I need any technical setup?',
    a: 'No. You tell us about your business and we handle everything technical, including connecting WhatsApp, Instagram, Messenger, and your website chat. Most businesses go live without touching a single setting.',
  },
  {
    q: 'How does the AI know my products and prices?',
    a: 'Your AI employee is grounded in the catalogue, hours, policies, and FAQs you give it. It only answers from your business information, so it never invents products or makes up prices.',
  },
  {
    q: 'What happens when the AI isn’t sure about something?',
    a: 'It hands the conversation to you. You get a notification, the customer gets a polite holding reply, and once you answer, the AI picks the conversation back up. You can also jump into any chat yourself at any time.',
  },
  {
    q: 'Can it really take orders and payments?',
    a: 'Yes. It confirms items, collects delivery details, supports cash on delivery and bank/wallet transfers with receipt screenshots, and logs every order to your dashboard, with an approval step if you want one.',
  },
  {
    q: 'Will it work with my existing WhatsApp number?',
    a: 'Yes. We connect your existing WhatsApp Business number, and your customers keep messaging the number they already know.',
  },
  {
    q: 'Can I try it before paying?',
    a: 'Yes. Build a working demo of your AI employee in minutes, free and with no card required. The free plan lets you keep it running with a daily conversation cap, and you can upgrade whenever you’re ready.',
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          {/* Matches the dashboard sidebar lockup exactly (mark + wordmark + subtext). */}
          <div className="flex items-center gap-3">
            <Logomark />
            <div className="min-w-0">
              <p className="font-logo text-2xl leading-none">CrewNest</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">By KraftNest Automations</p>
            </div>
          </div>
          <nav className="flex items-center gap-1.5 sm:gap-2">
            {/* Desktop only — unchanged. Below `md` this whole group was
                simply absent with no replacement: How it works/Features/
                Pricing/FAQ were unreachable on a phone (docs/27 §3 M1, D-01). */}
            <div className="mr-2 hidden items-center gap-1 md:flex">
              {SECTION_LINKS.map((link) => (
                <a key={link.href} href={link.href} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
                  {link.label}
                </a>
              ))}
            </div>
            {/*
              Mobile hamburger, below `md`. Reuses the same DropdownMenu
              primitive already proven for the dashboard's mobile "More" tab
              and business switcher — no Sheet component exists in this repo
              and the doc explicitly says not to add a dependency for this.
              Carries the four section anchors plus Try it free / Sign in, so
              every header destination is reachable even though the two CTA
              buttons also stay directly visible (removing an always-visible
              "Try it free" button to bury it in a menu would cost conversions
              for no benefit — the menu adds reach, it doesn't replace them).
            */}
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Menu"
                className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'md:hidden')}
              >
                <Menu className="size-5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                {SECTION_LINKS.map((link) => (
                  <DropdownMenuItem key={link.href} render={<a href={link.href} />}>
                    {link.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem render={<Link href="/try" />}>
                  <Sparkles className="size-4" />
                  Try it free
                </DropdownMenuItem>
                <DropdownMenuItem render={<Link href="/login?redirect=/dashboard" />}>
                  <LogIn className="size-4" />
                  Sign in
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Link href="/try" className={cn(buttonVariants({ size: 'sm' }))}>
              Try it free
            </Link>
            <Link href="/login?redirect=/dashboard" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
              <span className="sm:hidden">Sign in</span>
              <span className="hidden sm:inline">Client login</span>
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

          {/*
            One DOM, two orders (docs/27 §3 M2, D-05). Mobile order is plain
            DOM/flex order — badge, H1, HeroVisual, subhead, CTAs — so the
            demo (the page's only actual proof) sits right under the headline
            instead of after two more paragraphs of text plus a button row.
            Desktop keeps its original two-column arrangement via explicit
            grid placement: HeroVisual spans all four rows in column 2 while
            the other four pieces stack in column 1 in their original order.
            `items-start` (not center) on the grid so the growing chat demo
            can't push the headline/CTA column down as messages type in.
          */}
          <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-6 px-6 py-10 text-center lg:grid lg:grid-cols-[1fr_1.2fr] lg:items-start lg:gap-x-12 lg:gap-y-5 lg:py-28 lg:text-left">
            <Badge variant="secondary" className="lg:col-start-1 lg:row-start-1">
              Multi-channel AI employee
            </Badge>
            <h1
              className={cn(
                'font-hero-display',
                'text-4xl tracking-tight text-balance sm:text-5xl lg:col-start-1 lg:row-start-2',
              )}
            >
              Your business, answered instantly.
            </h1>
            {/*
              mt-8 on mobile only: HeroVisual's own floating "Runs your
              business…" badge sits at `-top-8` (32px) ABOVE its root's own
              top edge. On desktop that's fine — the badge floats above empty
              space in column 2. On mobile, HeroVisual sits directly under H1
              in normal flow, so that same -32px pull reached straight into
              the heading text (confirmed in a screenshot — the badge sat
              overlapping "answered instantly"). This margin exactly cancels
              the badge's own upward offset, landing it where the un-badged
              gap would have put HeroVisual's top edge in the first place.
            */}
            <HeroVisual className="mt-8 lg:col-start-2 lg:row-start-1 lg:row-span-4 lg:mt-0" />
            <p className="max-w-xl text-lg text-muted-foreground text-balance lg:col-start-1 lg:row-start-3">
              CrewNest gives your business an AI employee that answers customers across WhatsApp, Facebook,
              Instagram, and your website. Every answer is grounded in your catalogue, with a human one tap away.
            </p>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row lg:col-start-1 lg:row-start-4">
              <Link href="/try" className={cn(buttonVariants({ size: 'lg' }), 'w-full sm:w-auto')}>
                Try it free for your business
              </Link>
              <Link
                href="/signup"
                className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'w-full sm:w-auto')}
              >
                Sign up
              </Link>
            </div>
          </div>
        </section>

        {/* Channel strip — honest social proof until real customer logos exist. */}
        <section className="border-y border-border bg-card">
          <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-4 px-6 py-8 sm:flex-row sm:justify-between">
            <p className="text-sm font-medium text-muted-foreground">Works where your customers already are</p>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
              {CHANNELS.map((id) => (
                <span key={id} className="flex items-center gap-2 text-sm font-medium text-foreground/80">
                  <PlatformBadge platform={id} className="size-7 rounded-lg" iconClassName="size-3.5" />
                  {PLATFORMS[id].label}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="mx-auto w-full max-w-7xl scroll-mt-20 px-6 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <Badge variant="secondary">How it works</Badge>
            <h2 className={cn(displayFont.className, 'mt-4 text-3xl tracking-tight text-balance')}>
              Live in three steps. We do the technical part.
            </h2>
            <p className="mt-3 text-muted-foreground text-balance">
              Built for business owners, not developers. If you can fill in a form, you can hire an AI employee.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <Card key={step.title} className="relative h-full">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <span className="inline-flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                      <step.icon className="size-4" />
                    </span>
                    <span className={cn(displayFont.className, 'text-3xl font-semibold text-muted-foreground/30')}>
                      {i + 1}
                    </span>
                  </div>
                  <CardTitle className={cn(displayFont.className, 'mt-2 font-semibold')}>{step.title}</CardTitle>
                  <CardDescription>{step.description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>

        <section id="features" className="mx-auto w-full max-w-7xl scroll-mt-20 px-6 pb-20">
          {/*
            Previously four cards with no section title at all — heading order
            on the page was H1, H2, H2, H2, H2 (this section had none), and it
            was absent from every nav list (docs/27 §4 M4, D-02). Matches the
            exact heading block shape every other section already uses.
          */}
          <div className="mx-auto max-w-2xl text-center">
            <Badge variant="secondary">Features</Badge>
            <h2 className={cn(displayFont.className, 'mt-4 text-3xl tracking-tight text-balance')}>
              Everything runs in one place.
            </h2>
            <p className="mt-3 text-muted-foreground text-balance">
              One inbox, grounded answers, captured orders, and a human always one tap away.
            </p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
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

        <section id="pricing" className="scroll-mt-20 border-t border-border bg-card">
          <div className="mx-auto w-full max-w-7xl px-6 py-20">
            <div className="mx-auto max-w-2xl text-center">
              <Badge variant="secondary">Pricing</Badge>
              <h2 className={cn(displayFont.className, 'mt-4 text-3xl tracking-tight text-balance')}>
                Simple pricing that grows with you.
              </h2>
              <p className="mt-3 text-muted-foreground text-balance">
                Start free, no card required. Upgrade when your AI employee is earning its keep.
              </p>
            </div>
            {/* Four tiers now — 2-up on tablet, 4-up on desktop (was md:grid-cols-3
                with three plans, which would have orphaned the fourth card). */}
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {PAYWALL_PLANS.map((plan) => {
                // Driven by the plan config, not a hardcoded id, so moving the
                // emphasis is a one-line data change.
                const highlighted = Boolean(plan.highlight);
                return (
                  // Badge lives on a wrapper — Card itself is overflow-hidden and would clip it.
                  <div key={plan.id} className="relative h-full">
                    {highlighted && (
                      <Badge className="absolute -top-2.5 left-1/2 z-10 -translate-x-1/2">Most popular</Badge>
                    )}
                    <Card className={cn('h-full', highlighted && 'shadow-lg ring-primary/40')}>
                    <CardHeader>
                      <CardTitle className={cn(displayFont.className, 'font-semibold')}>{plan.name}</CardTitle>
                      <p className={cn(displayFont.className, 'text-3xl font-semibold tracking-tight')}>
                        {plan.price}
                      </p>
                      <CardDescription>{plan.tagline}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex h-full flex-col justify-between gap-6">
                      <ul className="flex flex-col gap-2.5">
                        {plan.features.map((feature) => (
                          <li key={feature} className="flex items-start gap-2 text-sm text-foreground/85">
                            <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                            {feature}
                          </li>
                        ))}
                      </ul>
                      <Link
                        href="/try"
                        className={cn(
                          buttonVariants({ variant: highlighted ? 'default' : 'outline' }),
                          'w-full',
                        )}
                      >
                        {plan.id === 'free' ? 'Start free' : `Start with ${plan.name}`}
                      </Link>
                    </CardContent>
                    </Card>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section id="faq" className="mx-auto w-full max-w-3xl scroll-mt-20 px-6 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <Badge variant="secondary">FAQ</Badge>
            <h2 className={cn(displayFont.className, 'mt-4 text-3xl tracking-tight text-balance')}>
              Questions business owners actually ask.
            </h2>
          </div>
          <div className="mt-10 flex flex-col gap-3">
            {FAQS.map((faq) => (
              <details
                key={faq.q}
                className="group rounded-xl border border-border bg-card px-5 py-4 open:shadow-sm"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
                  {faq.q}
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{faq.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="border-t border-border bg-card">
          <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-5 px-6 py-16 text-center">
            <h2 className={cn(displayFont.className, 'text-3xl tracking-tight text-balance')}>
              Hire your first AI employee today.
            </h2>
            <p className="max-w-xl text-muted-foreground text-balance">
              See it answering questions about your own business in minutes, before you pay anything.
            </p>
            <Link href="/try" className={cn(buttonVariants({ size: 'lg' }))}>
              Try it free for your business
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto w-full max-w-7xl px-6 py-10">
          <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
            <div className="max-w-xs">
              <div className="flex items-center gap-2">
                <Logomark className="size-6" />
                <span className="font-logo text-lg">CrewNest</span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                AI employees that answer your customers, take orders, and never miss a message.
              </p>
            </div>
            {/*
              gap-6 (24px), not gap-2.5 (10px), on all three link columns
              below — the touch-target expansion added in this same change
              (docs/27 §3 M3) gives every <a> a 44px-tall invisible hit area
              centred on it, and pseudo-elements from adjacent DOM siblings
              paint in DOM order, so at 10px apart the lower link's expanded
              zone consistently won taps meant for the one above it (measured:
              a tap at the exact midpoint between two 10px-apart links landed
              on the SECOND one every time, not neither). 24px gives each
              44px zone room to not touch its neighbour's at all.
            */}
            <div className="grid grid-cols-2 gap-8 text-sm sm:grid-cols-3">
              <div className="flex flex-col gap-6">
                <p className="font-medium text-foreground">Product</p>
                {SECTION_LINKS.map((link) => (
                  <a key={link.href} href={link.href} className="text-muted-foreground hover:text-foreground">
                    {link.label}
                  </a>
                ))}
              </div>
              <div className="flex flex-col gap-6">
                <p className="font-medium text-foreground">Get started</p>
                <Link href="/try" className="text-muted-foreground hover:text-foreground">
                  Try it free
                </Link>
                <Link href="/login?redirect=/dashboard" className="text-muted-foreground hover:text-foreground">
                  Client login
                </Link>
              </div>
              <div className="flex flex-col gap-6">
                <p className="font-medium text-foreground">Legal</p>
                <Link href="/privacy" className="text-muted-foreground hover:text-foreground">
                  Privacy policy
                </Link>
                <Link href="/terms" className="text-muted-foreground hover:text-foreground">
                  Terms of service
                </Link>
              </div>
            </div>
          </div>
          <p className="mt-10 border-t border-border pt-6 text-xs text-muted-foreground">
            © {new Date().getFullYear()} CrewNest. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
