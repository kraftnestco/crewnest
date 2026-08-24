'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { usePathname } from 'next/navigation';

/**
 * next-themes injects an inline <script> to prevent FOUC. React 19 / Next 16
 * flag that as a console error even though the script is intentional and only
 * needs to run during SSR. Filter that one message in dev so login/signup
 * aren't blocked by the overlay (shadcn dark-mode guide workaround).
 */
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === 'string' && first.includes('Encountered a script tag')) return;
    originalError.apply(console, args);
  };
}

/**
 * Class-based theme switching (docs: UI overhaul, Phase U1).
 *
 * Auth pages follow the OS. Dashboards default to dark until the user picks
 * light/dark/system. Public marketing is forced light.
 *
 * Do NOT remount this provider with a route `key`. Remounting re-renders the
 * theme <script> on the client and is what made Sign in / Sign up / "Get it
 * for real" trip the React 19 script-tag overlay.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuth = pathname.startsWith('/login') || pathname.startsWith('/signup');
  const isAppDashboard = pathname.startsWith('/dashboard') || pathname.startsWith('/admin');
  const isPublic = !isAuth && !isAppDashboard;

  return (
    <NextThemesProvider
      attribute="class"
      enableSystem
      defaultTheme={isAppDashboard ? 'dark' : isAuth ? 'system' : 'light'}
      forcedTheme={isPublic ? 'light' : undefined}
      storageKey="theme"
      disableTransitionOnChange
      scriptProps={typeof window === 'undefined' ? undefined : { type: 'application/json' }}
    >
      {children}
    </NextThemesProvider>
  );
}
