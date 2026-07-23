import { Space_Grotesk } from 'next/font/google';

/**
 * Brand display font (docs: UI overhaul, Phase U1). Loaded once in the root
 * layout as `--font-display` and mapped to `--font-heading` in globals.css, so
 * every `font-heading` heading — marketing AND app — carries it. Marketing
 * surfaces may still apply `displayFont.className` directly for hero type.
 */
export const displayFont = Space_Grotesk({
  variable: '--font-display',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
});
