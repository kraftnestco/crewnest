/*
  Laptop/desktop hero backup — 2026-08-23 (before mobilehero.png bg swap → v19)
  Source: landing-links.js HERO_LAYOUT_ID cn-mobile-hero-layout-v17 target state
  Note: live file was v18 at backup time; this captures the v17 bundle-layout
  desktop block to restore if the bg-only experiment is reverted.

  RESTORE: In landing-links.js @media (min-width: 1024px), replace the v19
  bg-only block with ONLY the rules below, set HERO_LAYOUT_ID to v17.
*/

      @media (min-width: 1024px) {
        .cn-mobile-bubbles { display: none !important; }
      }
