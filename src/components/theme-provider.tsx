'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { usePathname } from 'next/navigation';

/**
 * Class-based theme switching (docs: UI overhaul, Phase U1).
 *
 * Auth pages always follow the OS (a separate storage key so a dashboard
 * light/dark choice never leaks onto login/signup). Dashboards default to
 * dark until the user picks light, dark, or system. Public marketing stays
 * light.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuth = pathname.startsWith('/login') || pathname.startsWith('/signup');
  const isAppDashboard = pathname.startsWith('/dashboard') || pathname.startsWith('/admin');
  const routeThemeScope = isAuth ? 'auth' : isAppDashboard ? 'app' : 'public';

  return (
    <NextThemesProvider
      key={routeThemeScope}
      attribute="class"
      enableSystem
      defaultTheme={isAuth ? 'system' : isAppDashboard ? 'dark' : 'light'}
      storageKey={isAuth ? 'cn-theme-auth' : 'theme'}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
