import { Bricolage_Grotesque, Fraunces } from 'next/font/google';

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
 * titles, dashboard chrome) stays on `displayFont` above. Fraunces is a soft,
 * warm optical serif (Claude-wordmark energy); loaded as the full variable
 * font so `.font-hero-display` (globals.css) can dial in the heavy weight and
 * large-optical `opsz` axis via `font-variation-settings`. `SOFT`/`WONK` axes
 * keep the curves rounded rather than sharp.
 */
export const heroFont = Fraunces({
  variable: '--font-hero',
  subsets: ['latin'],
  weight: 'variable',
  style: ['normal'],
  axes: ['opsz', 'SOFT', 'WONK'],
});
