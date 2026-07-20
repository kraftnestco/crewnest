import { Space_Grotesk } from 'next/font/google';

/**
 * Display font for the public marketing surfaces only (landing + demo) — kept
 * out of globals.css/`--font-heading` on purpose so the dashboard/admin app
 * keeps its current Geist-based look untouched. Apply `displayFont.className`
 * directly to headings within src/app/page.tsx, src/app/try/, and
 * src/components/demo/*.
 */
export const displayFont = Space_Grotesk({
  variable: '--font-display',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
});
