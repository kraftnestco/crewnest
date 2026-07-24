import { Bricolage_Grotesque, Big_Shoulders } from 'next/font/google';

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
 * Hero/wordmark font, reserved for the true marketing headline and the
 * "CrewNest" brand lockup only — everything else (section headings, card
 * titles, dashboard chrome) stays on `displayFont` above. Loaded as the full
 * variable font so `.font-hero-display` (globals.css) can dial in the
 * Display-cut optical size via `font-variation-settings`, since next/font
 * only ships the base "Big Shoulders" family, not separately named
 * Display/Text instances.
 */
export const heroFont = Big_Shoulders({
  variable: '--font-hero',
  subsets: ['latin'],
  weight: 'variable',
});
