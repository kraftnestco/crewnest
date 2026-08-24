'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { HeroVisual, type HeroVisualVariant } from './hero-visual';
import { PlatformBadge, type PlatformId } from './platform-icons';

const DOORS: { value: HeroVisualVariant; label: string }[] = [
  { value: 'products', label: 'I sell products' },
  { value: 'bookings', label: 'I take bookings' },
];

/**
 * M7 (docs/27 §7 / §9) — the two-door hero switch. Owns `variant` state so it
 * can hand the same value to both the door control and `HeroVisual`, which
 * sit in different columns of the parent grid (page.tsx) and can't share
 * state through DOM order alone. Everything from the badge through the trust
 * row lives here (not just the switch) so the mobile flex order — badge, H1,
 * demo, subhead, switch, CTAs, trust — stays exactly what docs/27 §3 M2
 * specifies, instead of fighting a Fragment's fixed child order.
 */
export function HeroSection({ channels }: { channels: PlatformId[] }) {
  const [variant, setVariant] = useState<HeroVisualVariant>('products');

  return (
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
        Your business, answered <span className="text-primary">instantly.</span>
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
        `lg:row-span-5` now reaches down to the CTA row (row 5) since
        the door switch below added a row between the subhead and CTAs.
      */}
      <HeroVisual variant={variant} className="mt-8 lg:col-start-2 lg:row-start-1 lg:row-span-5 lg:mt-0" />
      <p className="max-w-xl text-lg text-muted-foreground text-balance lg:col-start-1 lg:row-start-3">
        An AI employee that answers WhatsApp, Facebook, Instagram, and web chat, takes orders and
        bookings, grounded in your catalogue, with a human one tap away.
      </p>
      <div
        role="radiogroup"
        aria-label="Show a demo for"
        className="inline-flex items-center gap-1 rounded-full bg-muted p-1 lg:col-start-1 lg:row-start-4 lg:self-start"
      >
        {DOORS.map((door) => (
          <button
            key={door.value}
            type="button"
            role="radio"
            aria-checked={variant === door.value}
            onClick={() => setVariant(door.value)}
            className={cn(
              'rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
              variant === door.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {door.label}
          </button>
        ))}
      </div>
      <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row lg:col-start-1 lg:row-start-5">
        <Link href="/try" className={cn(buttonVariants({ size: 'lg' }), 'w-full sm:w-auto')}>
          Try it free for your business
        </Link>
        <Link href="/signup" className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'w-full sm:w-auto')}>
          Sign up
        </Link>
      </div>
      {/*
        M8 (docs/27 §3) — trust row directly under the hero CTAs, above
        the fold on desktop. No verified usage numbers exist yet, so
        per the spec ("do not invent social proof") this ships channel
        logos plus the no-card line only; count-up motion for real
        numbers is Stage 6, once there's something honest to count.
      */}
      <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground sm:flex-row lg:col-start-1 lg:row-start-6 lg:items-center lg:justify-start">
        <div className="flex items-center -space-x-2">
          {channels.map((id) => (
            <PlatformBadge key={id} platform={id} className="size-7 rounded-full ring-2 ring-background" iconClassName="size-3" />
          ))}
        </div>
        <span>No card required to try it.</span>
      </div>
    </div>
  );
}
