'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Segment-level error boundary for /dashboard. Without this, any render error
 * on a client dashboard page bubbles all the way up to `app/global-error.tsx`,
 * which replaces the ENTIRE shell (no sidebar, no topbar, no sign-out) with a
 * bare "Something went wrong" — and hides the actual error, leaving no way to
 * recover short of a full reload. Catching it here keeps the shell intact and
 * offers a real "Try again" (re-render) plus a hard reload, and surfaces the
 * underlying message + stack in a collapsed block so the cause can be copied
 * out instead of guessed at. Mirrors global-error.tsx's Sentry capture (a
 * no-op when SENTRY_DSN isn't set).
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="space-y-1">
        <h1 className="font-page-heading text-2xl">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          We hit an unexpected error loading this page. Try again, or reload.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button type="button" onClick={() => reset()}>
          Try again
        </Button>
        <Button type="button" variant="outline" onClick={() => window.location.reload()}>
          Reload page
        </Button>
      </div>

      {/* Collapsed by default so the raw error never shouts at a non-technical
          owner, but one click reveals exactly what failed — copy this and send
          it over instead of the generic "Something went wrong". */}
      <details className="mt-2 w-full max-w-xl text-left">
        <summary className="cursor-pointer text-xs text-muted-foreground underline underline-offset-2">
          Show technical details
        </summary>
        <pre className="mt-2 overflow-auto rounded-lg bg-muted p-3 text-[11px] leading-snug text-muted-foreground">
          {error.message}
          {error.digest ? `\n\nDigest: ${error.digest}` : ''}
          {error.stack ? `\n\n${error.stack}` : ''}
        </pre>
      </details>
    </div>
  );
}
