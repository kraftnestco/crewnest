import { Bricolage_Grotesque, Big_Shoulders, Baloo_2 } from 'next/font/google';

/**
 * Brand display font (docs: UI overhaul, Phase U1). Loaded once in the root
 * layout as `--font-display` and mapped to `--font-heading` in globals.css, so
 * every `font-heading` heading — marketing AND app — carries it. Marketing
 * surfaces may still apply `displayFont.className` directly for hero type.
 */
export const displayFont = Bricolage_Grotesque({
  variable: '--font-display',
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
});

/**
 * Hero/heading display font — the big marketing headline and the app's page
 * headings (`.font-hero-display`). Big Shoulders, loaded as the full variable
 * font so `.font-hero-display` (globals.css) can dial in the Display-cut
 * optical size via `font-variation-settings`. Deliberately NOT the wordmark
 * font — the "CrewNest" logo has its own `logoFont` below so the two can be
 * tuned independently.
 */
export const heroFont = Big_Shoulders({
  variable: '--font-hero',
  subsets: ['latin'],
  weight: 'variable',
});

/**
 * Logo/wordmark font — used by `.font-logo` on the "CrewNest" lockup ONLY
 * (sidebar, marketing nav/footer, mobile topbar) and nowhere else. Baloo 2 is
 * a rounded, thick display face for a warm, brand-forward wordmark; carried at
 * a bold weight (see `.font-logo` in globals.css).
 */
export const logoFont = Baloo_2({
  variable: '--font-logo',
  subsets: ['latin'],
  weight: ['600', '700', '800'],
});
