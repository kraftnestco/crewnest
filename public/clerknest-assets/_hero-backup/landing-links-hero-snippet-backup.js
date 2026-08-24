hanges (or first scrub mount) update the track; height-only
    // URL-bar noise is ignored inside ensurePlatformScrub via lockedScrubVh.
    ensurePlatformScrub();
  }, { passive: true });

  /*
    Mobile first fold — dark hero, white type, ManyChat-style chat stage.
    Fixed hero height + absolute bubble slots so demo never shifts page scroll.
  */
  const HERO_LAYOUT_ID = "cn-mobile-hero-layout-v13";

  const ensureHeroLayoutStyle = () => {
    ["cn-mobile-hero-layout", "cn-mobile-hero-layout-v2", "cn-mobile-hero-layout-v3", "cn-mobile-hero-layout-v4", "cn-mobile-hero-layout-v5", "cn-mobile-hero-layout-v6", "cn-mobile-hero-layout-v7", "cn-mobile-hero-layout-v8", "cn-mobile-hero-layout-v9", "cn-mobile-hero-layout-v10", "cn-mobile-hero-layout-v11", "cn-mobile-hero-layout-v12"].forEach(
      (id) => document.getElementById(id)?.remove(),
    );
    if (document.getElementById(HERO_LAYOUT_ID)) return;
    const style = document.createElement("style");
    style.id = HERO_LAYOUT_ID;
    style.textContent = `
      /*
        Applies at every viewport: the bundle's own .chat-msg animation
        (translateY slideUp) and smooth scrollTo both shift layout/scroll
        position as feature-section demos cycle. Fade-only + no smooth
        scroll removes that motion; lockGrowingDemoHeights() (JS) removes
        the container reflow that was the actual page-jump cause.
      */
      .chat-msg {
        animation: cn-section-msg-in 0.35s ease both !important;
      }
      @keyframes cn-section-msg-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      [class*="overflow-y-auto"][class*="scroll-smooth"] {
        scroll-behavior: auto !important;
      }
      /* First-view hero subtext — near-white on dark hero at every viewport. */
      .cn-mobile-hero .cn-hero-copy > p {
        color: rgba(250, 248, 243, 0.92) !important;
        -webkit-text-fill-color: rgba(250, 248, 243, 0.92) !important;
      }
      /* Bottom category ticker + fade band — hidden globally, not just mobile. */
      .marquee,
      .cn-mobile-hero > .marquee,
      .cn-mobile-hero .marquee {
        display: none !important;
      }
      .cn-mobile-hero > .absolute.inset-x-0.bottom-0 {
        display: none !important;
      }
      @media (max-width: 1023px) {
        html {
          overflow-x: clip !important;
          scroll-behavior: auto !important;
        }
        body {
          overflow-x: clip !important;
        }
        .cn-mobile-hero {
          overflow: hidden !important;
          background: #0d0b09 !important;
          position: relative !important;
          transform: none !important;
          will-change: auto !important;
          isolation: isolate !important;
          display: flex !important;
          flex-direction: column !important;
        }
        .cn-mobile-hero [data-parallax],
        .cn-mobile-hero .hero-photo,
        .cn-mobile-hero .hero-mesh {
          transform: none !important;
          will-change: auto !important;
        }
        .scroll-progress {
          display: none !important;
        }
        .cn-mobile-hero .bubble-deco {
          display: none !important;
        }
        .cn-mobile-hero > .max-w-7xl {
          display: flex !important;
          flex-direction: column !important;
          flex: 1 1 auto !important;
          min-height: 0 !important;
          height: auto !important;
          padding-top: 5.25rem !important;
          padding-bottom: 0 !important;
          justify-content: flex-start !important;
        }
        .cn-mobile-hero .cn-hero-copy {
          display: flex !important;
          flex-direction: column !important;
          align-items: flex-start !important;
          flex: 0 0 auto !important;
          min-height: 0 !important;
          position: relative !important;
          z-index: 2 !important;
          gap: 0 !important;
          max-width: 20.5rem !important;
          transform: none !important;
          opacity: 1 !important;
        }
        /* Desktop badge — keep above headline, compact for first fold. */
        .cn-mobile-hero .cn-hero-copy [data-cn-hero-badge] {
          display: inline-flex !important;
          align-items: center !important;
          gap: 0.4rem !important;
          margin: 0 0 0.55rem !important;
          padding: 0.28rem 0.7rem !important;
          border: 1px solid rgba(255, 255, 255, 0.18) !important;
          background: rgba(255, 255, 255, 0.1) !important;
          border-radius: 999px !important;
          backdrop-filter: blur(8px);
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18) !important;
          color: rgba(250, 248, 243, 0.9) !important;
          -webkit-text-fill-color: rgba(250, 248, 243, 0.9) !important;
          font-size: 0.625rem !important;
          font-weight: 600 !important;
          letter-spacing: 0.02em !important;
          line-height: 1.2 !important;
          max-width: 100% !important;
        }
        .cn-mobile-hero .cn-hero-copy [data-cn-hero-badge] span {
          color: inherit !important;
          -webkit-text-fill-color: inherit !important;
          font-size: inherit !important;
        }
        /* Overlapping channel icons + uppercase label under CTAs. */
        .cn-mobile-hero .cn-hero-copy [data-cn-hero-platforms] {
          display: flex !important;
          align-items: center !important;
          gap: 0.55rem !important;
          margin: 0.7rem 0 0 !important;
          max-width: 100% !important;
        }
        .cn-mobile-hero .cn-hero-copy [data-cn-hero-platforms] > div {
          display: flex !important;
          flex-shrink: 0 !important;
        }
        .cn-mobile-hero .cn-hero-copy [data-cn-hero-platforms] span.w-6,
        .cn-mobile-hero .cn-hero-copy [data-cn-hero-platforms] [class*="w-6"] {
          width: 1.35rem !important;
          height: 1.35rem !important;
          min-width: 1.35rem !important;
        }
        .cn-mobile-hero .cn-hero-copy [data-cn-hero-platforms] p {
          margin: 0 !important;
          color: rgba(250, 248, 243, 0.88) !important;
          -webkit-text-fill-color: rgba(250, 248, 243, 0.88) !important;
          font-size: 0.5625rem !important;
          font-weight: 700 !important;
          letter-spacing: 0.12em !important;
          text-transform: uppercase !important;
          line-height: 1.25 !important;
          max-width: 11.5rem !important;
        }
        .cn-mobile-hero .reveal,
        .cn-mobile-hero .reveal-left,
        .cn-mobile-hero .reveal-right,
        .cn-mobile-hero .reveal-clip,
        .cn-mobile-hero .reveal-blur {
          transform: none !important;
          opacity: 1 !important;
          filter: none !important;
          clip-path: none !important;
        }
        .cn-mobile-hero .cn-hero-copy > :nth-child(4) {
          margin-top: 0 !important;
        }
        .cn-mobile-hero .cn-hero-copy h1,
        .cn-mobile-hero .cn-hero-copy [class*="text-[30px]"] {
          font-size: 1.75rem !important;
          line-height: 1.12 !important;
          margin-bottom: 0.55rem !important;
          letter-spacing: -0.02em !important;
        }
        .cn-mobile-hero .cn-hero-copy > p {
          font-size: 0.8125rem !important;
          line-height: 1.35 !important;
          margin-bottom: 0.9rem !important;
          max-width: 17.5rem !important;
        }
        .cn-mobile-hero .cn-hero-visual {
          display: none !important;
        }
        .cn-mobile-hero .hero-mesh {
          display: none !important;
        }
        .cn-mobile-hero .hero-photo {
          background-image: url("/clerknest-assets/mobilehero.png") !important;
          background-size: cover !important;
          background-position: center 58% !important;
          background-repeat: no-repeat !important;
          filter: brightness(0.62) saturate(0.85) contrast(1.05) !important;
        }
        /* Darker left scrim so white copy reads cleanly over busy photo. */
        .cn-mobile-hero .hero-photo + div {
          background: linear-gradient(
            100deg,
            rgba(13, 11, 9, 0.88) 0%,
            rgba(13, 11, 9, 0.72) 38%,
            rgba(13, 11, 9, 0.48) 62%,
            rgba(13, 11, 9, 0.62) 100%
          ) !important;
        }
        .cn-mobile-hero .cn-hero-copy,
        .cn-mobile-hero .cn-hero-copy p,
        .cn-mobile-hero .cn-hero-copy h1,
        .cn-mobile-hero .cn-hero-copy h2,
        .cn-mobile-hero .cn-hero-copy [class*="text-ivory"] {
          color: #faf8f3 !important;
          -webkit-text-fill-color: #faf8f3 !important;
        }
        .cn-mobile-hero .cn-hero-copy .text-grad-rose {
          color: #d91b5b !important;
          background: none !important;
          -webkit-background-clip: unset !important;
          background-clip: unset !important;
          -webkit-text-fill-color: #d91b5b !important;
        }
        .cn-mobile-hero .cn-hero-copy > div:has(.bg-grad-rose),
        .cn-mobile-hero .cn-hero-copy > div:has(a) {
          display: flex !important;
          flex-direction: row !important;
          flex-wrap: wrap !important;
          align-items: center !important;
          gap: 0.55rem !important;
          width: auto !important;
        }
        .cn-mobile-hero .cn-hero-copy .bg-grad-rose {
          background: #d91b5b !important;
          color: #faf8f3 !important;
          -webkit-text-fill-color: #faf8f3 !important;
          box-shadow: 0 8px 20px rgba(217, 27, 91, 0.35) !important;
          padding: 0.7rem 1.15rem !important;
          font-size: 0.8125rem !important;
          border-radius: 999px !important;
          width: auto !important;
          min-height: 2.65rem !important;
        }
        .cn-mobile-hero .cn-hero-copy a:not(.bg-grad-rose),
        .cn-mobile-hero .cn-hero-copy button:not(.bg-grad-rose) {
          border: 1.5px solid rgba(250, 248, 243, 0.35) !important;
          color: #faf8f3 !important;
          -webkit-text-fill-color: #faf8f3 !important;
          background: rgba(250, 248, 243, 0.08) !important;
          padding: 0.65rem 1rem !important;
          font-size: 0.8125rem !important;
          border-radius: 999px !important;
          width: auto !important;
          min-height: 2.65rem !important;
          backdrop-filter: blur(6px);
        }
        .cn-mobile-bubbles {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 0.5rem;
          position: relative;
          left: auto;
          right: auto;
          bottom: auto;
          margin-top: auto;
          flex-shrink: 0;
          padding: 0.75rem 1rem 1.1rem;
          z-index: 3;
          pointer-events: none;
          height: auto;
          min-height: 0;
          contain: none;
          overflow: visible;
        }
        .cn-channel-pill {
          align-self: flex-start;
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.28rem 0.65rem;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.12);
          color: #faf8f3;
          font-size: 0.6875rem;
          font-weight: 700;
          letter-spacing: 0.02em;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
          backdrop-filter: blur(8px);
          border: 1px solid rgba(255, 255, 255, 0.12);
        }
        .cn-channel-pill::before {
          content: "";
          width: 0.45rem;
          height: 0.45rem;
          border-radius: 999px;
          background: var(--cn-channel-accent, #25D366);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--cn-channel-accent, #25D366) 25%, transparent);
        }
        .cn-bubble-stage {
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          gap: 0.45rem;
          width: 100%;
          min-height: 5.5rem;
          overflow: visible;
        }
        .cn-bubble {
          max-width: 88%;
          position: relative;
          margin: 0;
        }
        .cn-bubble-user {
          align-self: flex-start;
          background: rgba(250, 248, 243, 0.14);
          color: #faf8f3;
          border-radius: 1.15rem 1.15rem 1.15rem 0.35rem;
          padding: 0.65rem 0.85rem;
          font-size: 0.8125rem;
          line-height: 1.35;
          font-weight: 500;
          backdrop-filter: blur(10px);
          box-shadow: 0 8px 22px rgba(0, 0, 0, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .cn-bubble-typing {
          align-self: flex-end;
          display: inline-flex;
          align-items: center;
          gap: 0.28rem;
          background: #d91b5b;
          border-radius: 1.15rem 1.15rem 0.35rem 1.15rem;
          padding: 0.62rem 0.85rem;
          box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
        }
        .cn-bubble-typing span {
          width: 0.34rem;
          height: 0.34rem;
          border-radius: 999px;
          background: rgba(250, 248, 243, 0.85);
          animation: cn-typing-dot 1.1s ease-in-out infinite;
        }
        .cn-bubble-typing span:nth-child(2) { animation-delay: 0.15s; }
        .cn-bubble-typing span:nth-child(3) { animation-delay: 0.3s; }
        .cn-bubble-ai {
          align-self: flex-end;
          background: #d91b5b;
          color: #faf8f3;
          border-radius: 1.15rem 1.15rem 0.35rem 1.15rem;
          padding: 0.75rem 0.9rem;
          box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
        }
        .cn-bubble-ai p {
          margin: 0;
          font-size: 0.8125rem;
          line-height: 1.35;
          font-weight: 600;
        }
        .cn-bubble-chip {
          align-self: center;
          margin-top: 0.15rem;
          padding: 0.28rem 0.65rem;
          border-radius: 999px;
          background: rgba(250, 248, 243, 0.12);
          color: #faf8f3;
          font-size: 0.6875rem;
          font-weight: 600;
          letter-spacing: 0.01em;
          border: 1px solid rgba(255, 255, 255, 0.14);
          backdrop-filter: blur(8px);
        }
        .cn-bubble-pop {
          animation: cn-bubble-in 0.38s ease both;
        }
        .cn-bubble[hidden],
        .cn-bubble-chip[hidden] {
          display: none !important;
        }
        @keyframes cn-bubble-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes cn-typing-dot {
          0%, 80%, 100% { opacity: 0.35; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-2px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .cn-bubble-pop { animation: none !important; }
          .cn-bubble-typing span { animation: none !important; opacity: 0.85; }
        }
        [class*="h-[318px]"],
        [class*="h-\\[318px\\]"] {
          min-height: 318px !important;
          max-height: 318px !important;
          overflow: hidden !important;
        }
        .overflow-y-auto.scroll-smooth {
          overflow: hidden !important;
        }
        /*
          Channel-switcher tabs in "One employee. Native everywhere.":
          fit all four on ONE mobile row (no wrap, no fade, no clip).
          JS shortens "Instagram DMs"→"Instagram" and "Website Chat"→"Web";
          CSS shrinks padding / type / icons / gap to match ~360px width.
        */
        [class*="overflow-x-auto"][class*="mb-8"] {
          overflow: visible !important;
          justify-content: center !important;
          flex-wrap: nowrap !important;
          -webkit-mask-image: none !important;
          mask-image: none !important;
        }
        [class*="overflow-x-auto"][class*="mb-8"] > [class*="inline-flex"][class*="rounded-full"] {
          display: flex !important;
          flex-wrap: nowrap !important;
          justify-content: center !important;
          align-items: center !important;
          width: max-content !important;
          max-width: 100% !important;
          flex-shrink: 1 !important;
          margin-left: auto !important;
          margin-right: auto !important;
          gap: 0.1rem !important;
          padding: 0.2rem !important;
          border-radius: 999px !important;
          box-sizing: border-box !important;
        }
        [class*="overflow-x-auto"][class*="mb-8"] button[class*="whitespace-nowrap"] {
          padding: 0.32rem 0.4rem !important;
          font-size: 0.625rem !important;
          line-height: 1.2 !important;
          gap: 0.2rem !important;
          flex: 0 0 auto !important;
          letter-spacing: -0.01em !important;
        }
        [class*="overflow-x-auto"][class*="mb-8"] button[class*="whitespace-nowrap"] svg {
          width: 0.65rem !important;
          height: 0.65rem !important;
          flex-shrink: 0 !important;
        }
      }
      @media (min-width: 1024px) {
        .cn-mobile-bubbles { display: none !important; }
      }
    `;
    document.head.appendChild(style);
  };

  /**
   * "

// --- applyHeroLayout ---

const applyHeroLayout = () => {
    const hero = document.querySelector("section[data-navtheme='dark']");
    if (!hero) return;
    hero.classList.add("cn-mobile-hero");
    document.body.classList.remove("cn-light-mobile-hero");
    const inner = hero.querySelector(".max-w-7xl");
    if (!inner || inner.children.length < 2) return;
    inner.children[0].classList.add("cn-hero-copy");
    inner.children[1].classList.add("cn-hero-visual");
    quietMobileHeroChrome();
    hideMarquee();
    lockMobileHeroHeight();
    freezeMobileScrollMotion();
    ensureMobileChatBubbles();
    scheduleDemoHeightLock();
    heroLayoutReady = true;
  };

  ensureHeroLayoutStyle();
  ens