import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { Logomark } from '@/app/_landing/logomark';
import { SUPPORT_EMAIL } from '@/lib/constants';

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
      <div className="flex w-full flex-col justify-center px-6 py-12 sm:px-12 lg:w-[46%] lg:px-16 xl:w-2/5">
        <div className="mx-auto w-full max-w-sm">
          <Logomark className="size-9" />
          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-balance">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>

          {whatNext && (
            <p className="mt-4 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{whatNext}</p>
          )}

          <div className="mt-6">{children}</div>

          {footer && <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>}

          <p className="mt-8 text-center text-xs text-muted-foreground">
            Trouble signing in?{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-foreground underline underline-offset-2">
              {SUPPORT_EMAIL}
            </a>
          </p>
        </div>
      </div>

      {/*
        Hidden below `lg` — form only on a phone, per the doc. The one
        concrete proof: a short, static (non-animated, no client JS needed
        here) two-message exchange echoing the marketing hero's visual
        language without importing its stateful animation logic into a
        secondary screen.
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
        <div className="relative mx-auto max-w-sm">
          <h2 className="font-hero-display text-3xl tracking-tight text-balance">
            Every customer message, answered instantly.
          </h2>
          <p className="mt-3 text-stage-deep-fg/80">
            Grounded in your actual catalogue — never a generic script, never a made-up price.
          </p>

          <div className="mt-8 flex flex-col gap-2.5">
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-white/10 px-3.5 py-2 text-sm">
                Do you have the Sea Green kurta in medium?
              </div>
            </div>
            <div className="flex justify-end">
              <div className="flex max-w-[80%] items-start gap-1.5 rounded-2xl rounded-br-md bg-white/95 px-3.5 py-2 text-sm text-stage-deep">
                <Sparkles className="mt-0.5 size-3.5 shrink-0 opacity-70" />
                Yes — medium is in stock, Rs. 2,500. Want me to place the order?
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
