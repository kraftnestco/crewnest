/**
 * Single source for every in-page section link — the header's desktop nav,
 * its mobile hamburger menu, and the footer's Product column all render from
 * this instead of three independent literal lists that could silently drift
 * (docs/27 §3 M1/§4 M4 — Features had no nav entry at all before this).
 */
export const SECTION_LINKS = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
] as const;
