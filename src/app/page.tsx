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
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PAYWALL_PLANS } from '@/services/demo/plans';
import { Logomark } from './_landing/logomark';
import { TiltCard } from './_landing/tilt-card';
import { HeroVisual } from './_landing/hero-visual';
import { displayFont } from './_landing/fonts';
import { PLATFORMS, PlatformBadge, type PlatformId } from './_landing/platform-icons';

const CHANNELS: PlatformId[] = ['whatsapp', 'instagram', 'messenger', 'web'];

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
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <Logomark />
            <span className={cn('font-hero-display', 'text-lg')}>
              Crew<span className="font-normal text-muted-foreground">Nest</span>
            </span>
          </div>
          <nav className="flex items-center gap-1.5 sm:gap-2">
            <div className="mr-2 hidden items-center gap-1 md:flex">
              <a href="#how-it-works" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
                How it works
              </a>
              <a href="#pricing" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
                Pricing
              </a>
              <a href="#faq" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
                FAQ
              </a>
            </div>
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

          <div className="mx-auto grid w-full max-w-5xl items-center gap-12 px-6 py-20 lg:grid-cols-[1fr_1.2fr] lg:py-28">
            <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
              <Badge variant="secondary">Multi-channel AI employee</Badge>
              <h1 className={cn('font-hero-display', 'mt-4 text-4xl tracking-tight text-balance sm:text-5xl')}>
                Your business, answered instantly.
              </h1>
              <p className="mt-4 max-w-xl text-lg text-muted-foreground text-balance">
                CrewNest gives your business an AI employee that answers customers across WhatsApp, Facebook,
                Instagram, and your website. Every answer is grounded in your catalogue, with a human one tap away.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
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

            <HeroVisual />
          </div>
        </section>

        {/* Channel strip — honest social proof until real customer logos exist. */}
        <section className="border-y border-border bg-card">
          <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-4 px-6 py-8 sm:flex-row sm:justify-between">
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

        <section id="how-it-works" className="mx-auto w-full max-w-5xl scroll-mt-20 px-6 py-20">
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

        <section id="features" className="mx-auto w-full max-w-5xl scroll-mt-20 px-6 pb-20">
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

        <section id="pricing" className="scroll-mt-20 border-t border-border bg-card">
          <div className="mx-auto w-full max-w-5xl px-6 py-20">
            <div className="mx-auto max-w-2xl text-center">
              <Badge variant="secondary">Pricing</Badge>
              <h2 className={cn(displayFont.className, 'mt-4 text-3xl tracking-tight text-balance')}>
                Simple pricing that grows with you.
              </h2>
              <p className="mt-3 text-muted-foreground text-balance">
                Start free, no card required. Upgrade when your AI employee is earning its keep.
              </p>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {PAYWALL_PLANS.map((plan) => {
                const highlighted = plan.id === 'starter';
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
          <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-5 px-6 py-16 text-center">
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
        <div className="mx-auto w-full max-w-5xl px-6 py-10">
          <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
            <div className="max-w-xs">
              <div className="flex items-center gap-2">
                <Logomark className="size-6" />
                <span className="font-hero-display">CrewNest</span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                AI employees that answer your customers, take orders, and never miss a message.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-8 text-sm sm:grid-cols-3">
              <div className="flex flex-col gap-2.5">
                <p className="font-medium text-foreground">Product</p>
                <a href="#how-it-works" className="text-muted-foreground hover:text-foreground">
                  How it works
                </a>
                <a href="#pricing" className="text-muted-foreground hover:text-foreground">
                  Pricing
                </a>
                <a href="#faq" className="text-muted-foreground hover:text-foreground">
                  FAQ
                </a>
              </div>
              <div className="flex flex-col gap-2.5">
                <p className="font-medium text-foreground">Get started</p>
                <Link href="/try" className="text-muted-foreground hover:text-foreground">
                  Try it free
                </Link>
                <Link href="/login?redirect=/dashboard" className="text-muted-foreground hover:text-foreground">
                  Client login
                </Link>
              </div>
              <div className="flex flex-col gap-2.5">
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
