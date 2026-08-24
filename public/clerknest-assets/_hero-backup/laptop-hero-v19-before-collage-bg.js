/*
  Laptop/desktop hero backup — 2026-08-23 (before hero-laptop-collage.jpg → v20)
  Source: landing-links.js HERO_LAYOUT_ID cn-mobile-hero-layout-v19

  RESTORE: Set HERO_LAYOUT_ID to v19 and replace @media (min-width: 1024px)
  bg block with the rules below.
*/

      @media (min-width: 1024px) {
        .cn-mobile-bubbles { display: none !important; }
        /*
          Desktop/laptop bg-only: mobilehero.png atmosphere. Original bundle
          two-column layout, dashboard visual, copy sizing all untouched.
          92% bg-size zooms out vs cover — shows more of the photo.
        */
        .cn-mobile-hero {
          background: #0d0b09 !important;
        }
        .cn-mobile-hero .hero-mesh {
          display: none !important;
        }
        .cn-mobile-hero .hero-photo {
          background-image: url("/clerknest-assets/mobilehero.png") !important;
          background-size: 92% !important;
          background-position: center center !important;
          background-repeat: no-repeat !important;
          filter: brightness(0.62) saturate(0.85) contrast(1.05) !important;
        }
        .cn-mobile-hero .hero-photo + div {
          background: linear-gradient(
            100deg,
            rgba(13, 11, 9, 0.88) 0%,
            rgba(13, 11, 9, 0.72) 38%,
            rgba(13, 11, 9, 0.48) 62%,
            rgba(13, 11, 9, 0.62) 100%
          ) !important;
        }
      }
