'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

/**
 * Class-based theme switching (docs: UI overhaul, Phase U1). Light is the
 * product's primary look — dark is a personal preference, so we default to
 * light rather than the OS setting; the toggle in the app top bar flips it.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="light" disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
