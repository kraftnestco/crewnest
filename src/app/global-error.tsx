'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

// Doc-17 S2 — last-resort net for a React render error that escapes every
// route's own error boundary. captureException is always safe to call; it's a
// no-op when SENTRY_DSN isn't set (see sentry.server.config.ts).
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center p-8 text-center">
        <div>
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="mt-1 text-sm text-muted-foreground">Please refresh the page and try again.</p>
        </div>
      </body>
    </html>
  );
}
