'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Menu, Sparkles, LogIn } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Logomark } from './logomark';
import { SECTION_LINKS } from './section-links';

/**
 * Client-only (not just its shrink state) so the "past the hero" scroll
 * listener and the nav/dropdown/CTA markup it toggles both live in one
 * component — a Server Component can't hand this JSX to a Client Component
 * via a render-prop, since functions aren't serializable across that
 * boundary. Shrinks the mark+wordmark lockup once scrolled (docs/27 §6.2
 * item 3, 72px → 56px): the padding swap below is instant, not transitioned
 * — only the lockup's own transform/opacity animate, per §6.3's rule
 * against animating layout-affecting properties.
 */
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        setScrolled(window.scrollY > 420);
        ticking = false;
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
      <div
        className={cn(
          'mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6',
          scrolled ? 'py-2' : 'py-3',
        )}
      >
        {/* Matches the dashboard sidebar lockup exactly (mark + wordmark + subtext) at rest. */}
        <div
          className={cn(
            'flex origin-left items-center gap-3 transition-transform duration-200 ease-out motion-reduce:transition-none',
            scrolled && 'scale-[0.82]',
          )}
        >
          <Logomark />
          <div
            className={cn(
              'min-w-0 transition-opacity duration-200 ease-out motion-reduce:transition-none',
              scrolled && 'opacity-0',
            )}
          >
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
  );
}
