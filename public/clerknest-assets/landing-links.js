(() => {
  const destinations = new Map([
    ["ClerkNest", "/"],
    ["Sign in", "/login?redirect=/dashboard"],
    ["Meet ClerkNest", "/try"],
    ["Build My AI Employee", "/try"],
    ["Hand over the night shift", "/try"],
    ["See it in action →", "/try"],
    ["See it live", "/try"],
    ["Features", "#features"],
    ["Pricing", "#pricing"],
    ["Integrations", "#features"],
    ["Privacy", "/privacy"],
    ["Terms", "/terms"],
    ["Security", "/security"],
  ]);

  const connectLinks = () => {
    document.querySelectorAll("a").forEach((link) => {
      const destination = destinations.get(link.textContent?.trim() ?? "");
      if (destination && link.getAttribute("href") !== destination) {
        link.setAttribute("href", destination);
      }
    });
  };

  connectLinks();
  const root = document.getElementById("root");
  if (root && root.childElementCount === 0) {
    const observer = new MutationObserver(() => {
      if (root.childElementCount > 0) {
        connectLinks();
        observer.disconnect();
      }
    });
    observer.observe(root, { childList: true });
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;

    const label = button.textContent?.trim() ?? "";
    if (/^(Start (Free|Starter|Growth|Pro)|Talk to Sales)$/.test(label)) {
      const link = document.createElement("a");
      link.href = "/try";
      link.click();
    }
  });

  // Mobile drawer fallback: some bundled nav entries are rendered as button-ish
  // elements instead of stable anchors. Force Sign in to open the auth route.
  document.addEventListener("click", (event) => {
    const target = event.target.closest("a, button, [role='button']");
    if (!target) return;
    const label = target.textContent?.trim().replace(/\s+/g, " ") ?? "";
    if (label !== "Sign in") return;

    event.preventDefault();
    window.location.assign("/login?redirect=/dashboard");
  });

  /*
    Header: fully transparent and unblurred at the top of the page, easing into
    its tinted/blurred state across the first NAV_FADE_DISTANCE of scroll. The
    landing page ships as a prebuilt bundle, so rather than editing minified
    JSX this reads the resting look the bundle asked for (its own bg-* class)
    and re-renders it at scroll-proportional strength on an inserted backdrop
    layer, leaving the header itself transparent.
  */
  const NAV_FADE_DISTANCE = 180;
  const NAV_MAX_BLUR = 24;
  const NAV_STATES = [
    // Mobile menu open — must stay fully opaque regardless of scroll position.
    { cls: "bg-white/95", bg: "255,255,255", bgAlpha: 0.95, border: "232,226,217", borderAlpha: 1, always: true },
    { cls: "bg-black/10", bg: "0,0,0", bgAlpha: 0.1, border: "255,255,255", borderAlpha: 0.1 },
    { cls: "bg-white/25", bg: "255,255,255", bgAlpha: 0.25, border: "0,0,0", borderAlpha: 0.05 },
  ];

  let navLayer = null;

  const paintHeader = () => {
    const header = document.querySelector("header.fixed");
    if (!header) return;

    if (!navLayer || !navLayer.isConnected) {
      navLayer = document.createElement("div");
      // z-index keeps it behind the header's own content; the header is
      // positioned, so this stays scoped to it.
      navLayer.style.cssText = "position:absolute;inset:0;z-index:-1;pointer-events:none;";
      header.prepend(navLayer);
    }

    const state = NAV_STATES.find((s) => header.classList.contains(s.cls));
    const scrolled = Math.min(1, Math.max(0, window.scrollY / NAV_FADE_DISTANCE));
    const strength = state && state.always ? 1 : scrolled;

    header.style.setProperty("background-color", "transparent", "important");
    header.style.setProperty("backdrop-filter", "none", "important");
    header.style.setProperty("-webkit-backdrop-filter", "none", "important");
    header.style.setProperty(
      "border-bottom-color",
      state ? `rgba(${state.border},${state.borderAlpha * strength})` : "transparent",
      "important",
    );

    navLayer.style.backgroundColor = state ? `rgba(${state.bg},${state.bgAlpha * strength})` : "transparent";
    const blur = strength <= 0.01 ? "none" : `blur(${(NAV_MAX_BLUR * strength).toFixed(1)}px)`;
    navLayer.style.backdropFilter = blur;
    navLayer.style.webkitBackdropFilter = blur;
  };

  let navTicking = false;
  const scheduleHeaderPaint = () => {
    if (navTicking) return;
    navTicking = true;
    requestAnimationFrame(() => {
      navTicking = false;
      paintHeader();
    });
  };

  // The bundle renders client-side, and once mounted it swaps the header's own
  // theme classes (hero vs. page, menu open) — watch just that element rather
  // than the whole tree, which churns on every reveal animation.
  const watchHeader = () => {
    const header = document.querySelector("header.fixed");
    if (!header) return false;
    new MutationObserver(scheduleHeaderPaint).observe(header, {
      attributes: true,
      attributeFilter: ["class"],
    });
    scheduleHeaderPaint();
    return true;
  };

  if (!watchHeader()) {
    const mountObserver = new MutationObserver(() => {
      if (watchHeader()) mountObserver.disconnect();
    });
    mountObserver.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener("scroll", scheduleHeaderPaint, { passive: true });
  window.addEventListener("resize", scheduleHeaderPaint, { passive: true });

  /*
    Mobile hero reference polish (user-provided screenshot):
    lock the first dark hero to the same visual rhythm (headline/CTAs/trust row)
    while keeping desktop untouched.
  */
  const MOBILE_BREAKPOINT = 768;
  const HERO_STYLE_ID = "cn-mobile-hero-ref";

  const ensureHeroStyle = () => {
    if (document.getElementById(HERO_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = HERO_STYLE_ID;
    style.textContent = `
      @media (max-width: 768px) {
        section.cn-mobile-hero-ref {
          background: #0d0b09 !important;
          overflow: hidden;
        }
        section.cn-mobile-hero-ref h1 {
          font-size: clamp(3.2rem, 13vw, 4.25rem) !important;
          line-height: 0.96 !important;
          letter-spacing: -0.04em !important;
          max-width: 9.2ch !important;
          margin-bottom: 0.55rem !important;
        }
        section.cn-mobile-hero-ref p {
          font-size: 1.14rem !important;
          line-height: 1.38 !important;
        }
        section.cn-mobile-hero-ref .cn-mobile-cta-primary,
        section.cn-mobile-hero-ref .cn-mobile-cta-secondary {
          width: min(100%, 18rem) !important;
          min-height: 3.7rem !important;
          border-radius: 1rem !important;
          font-size: 1.02rem !important;
          font-weight: 700 !important;
          letter-spacing: -0.01em !important;
        }
        section.cn-mobile-hero-ref .cn-mobile-cta-primary {
          margin-top: 0.35rem !important;
        }
        section.cn-mobile-hero-ref .cn-mobile-trust {
          margin-top: 1rem !important;
          font-size: 0.93rem !important;
          opacity: 0.98 !important;
        }
      }
    `;
    document.head.appendChild(style);
  };

  const labelOf = (el) => (el?.textContent?.trim().replace(/\s+/g, " ") ?? "");

  const applyMobileHeroReference = () => {
    if (window.innerWidth > MOBILE_BREAKPOINT) return;
    const hero = document.querySelector("section[data-navtheme='dark']");
    if (!hero) return;
    hero.classList.add("cn-mobile-hero-ref");

    const controls = Array.from(hero.querySelectorAll("a,button,[role='button']"));
    for (const node of controls) {
      const label = labelOf(node);
      if (label === "Meet ClerkNest") node.classList.add("cn-mobile-cta-primary");
      if (label === "See how it works") node.classList.add("cn-mobile-cta-secondary");
    }

    const textNodes = Array.from(hero.querySelectorAll("p,span,div"));
    const trust = textNodes.find((n) => /Loved by 500\+ salons, boutiques & clinics/i.test(labelOf(n)));
    if (trust) trust.classList.add("cn-mobile-trust");
  };

  ensureHeroStyle();
  applyMobileHeroReference();
  window.addEventListener("resize", applyMobileHeroReference, { passive: true });
  new MutationObserver(applyMobileHeroReference).observe(document.body, { childList: true, subtree: true });
})();
