'use client';

import { useSyncExternalStore } from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';

const subscribeNever = () => () => {};

/**
 * One-tap light/dark switch — deliberately a plain toggle, not a menu, so
 * non-technical users never face a "system vs light vs dark" decision.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // Theme is only known client-side; render a stable placeholder until mounted
  // so the server and first client render never disagree. useSyncExternalStore's
  // getServerSnapshot always returns false, matching the SSR/first-paint render;
  // the client snapshot is true from the very first client render onward — no
  // setState-in-effect needed for what is fundamentally a static after-mount flag.
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  const isDark = mounted && resolvedTheme === 'dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
