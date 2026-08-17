'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { usePathname } from 'next/navigation';

/**
 * Class-based theme switching (docs: UI overhaul, Phase U1).
 *
 * Auth signup is always dark. App dashboards start dark for users without a
 * saved preference, while next-themes persists an explicit light/dark choice
 * in localStorage. Public and login routes retain their light default.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isSignup = pathname.startsWith('/signup');
  const isAppDashboard = pathname.startsWith('/dashboard') || pathname.startsWith('/admin');
  const routeThemeScope = isSignup ? 'signup' : isAppDashboard ? 'app' : 'public';

  return (
    <NextThemesProvider
      key={routeThemeScope}
      attribute="class"
      defaultTheme={isAppDashboard ? 'dark' : 'light'}
      forcedTheme={isSignup ? 'dark' : undefined}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
