import type { ReactNode } from 'react';
import { Logomark } from '@/app/_landing/logomark';
import { SUPPORT_EMAIL } from '@/lib/constants';
import { AuthMarketingPanel } from './auth-marketing-panel';

/**
 * Shared shell for /login and /signup (docs/27 §4 A1-A3).
 *
 * Replaces the old centred `max-w-sm` card both pages used — a logo, a
 * heading, and two fields in the middle of an empty page is the exact visual
 * grammar of a phishing page, on the one screen where trust matters most
 * (D-10). Two changes fix that: the logo renders as an IMAGE, never a
 * heading — `title` becomes the real `<h1>`, stating the page's purpose
 * instead of just the wordmark — and a split screen on `lg+` gives the page
 * an actual reason to exist beyond the form: a `--stage-deep` panel carrying
 * one concrete proof, not a stock illustration.
 *
 * Below `lg`: form only, full width, panel hidden — unchanged from before
 * structurally, just no longer centred inside a small bordered card.
 */
export function AuthShell({
  title,
  description,
  whatNext,
  children,
  footer,
}: {
  title: string;
  description: string;
  /** A1/A3 — one line telling the visitor what to expect, shown above the form. */
  whatNext?: string;
  children: ReactNode;
  /** e.g. "Already have an account? Sign in" — rendered under the form. */
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {/*
        Vertical rhythm is deliberately tight: the whole column — down to the
        support line — has to clear a short laptop viewport without scrolling,
        which the previous 12/6/8 spacing scale didn't.
      */}
      <div className="flex w-full flex-col justify-center px-6 py-8 sm:px-12 lg:w-[46%] lg:px-16 xl:w-2/5">
        <div className="mx-auto w-full max-w-sm">
          <Logomark className="size-8" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-balance">{title}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>

          {whatNext && (
            <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{whatNext}</p>
          )}

          <div className="mt-4">{children}</div>

          {footer && <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div>}

          <p className="mt-4 text-center text-xs text-muted-foreground">
            Trouble signing in?{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-foreground underline underline-offset-2">
              {SUPPORT_EMAIL}
            </a>
          </p>
        </div>
      </div>

      {/*
        Hidden below `lg` — form only on a phone, per the doc. The live proof
        (AuthMarketingPanel) carries the marketing hero's motion language
        into a secondary screen; this shell just owns the static chrome
        around it — the dot-grid texture and two ambient glow orbs, both
        cheap CSS-only animation so this file itself stays a server
        component.
      */}
      <div className="relative hidden flex-1 items-center justify-center overflow-hidden bg-stage-deep p-12 text-stage-deep-fg lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />
        <div
          aria-hidden
          className="animate-float pointer-events-none absolute -top-24 -left-16 size-72 rounded-full bg-primary/25 blur-3xl"
          style={{ animationDuration: '9s' }}
        />
        <div
          aria-hidden
          className="animate-float pointer-events-none absolute -right-20 -bottom-24 size-80 rounded-full bg-primary/15 blur-3xl"
          style={{ animationDuration: '11s', animationDelay: '-4s' }}
        />
        <div className="relative">
          <AuthMarketingPanel />
        </div>
      </div>
    </div>
  );
}
