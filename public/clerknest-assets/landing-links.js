(() => {
  const destinations = new Map([
    ["ClerkNest", "/"],
    ["Sign in", "/login?redirect=/dashboard"],
    ["Sign up", "/signup"],
    ["Signup", "/signup"],
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

  const SIGNUP_MARK = "data-cn-signup";

  const injectSignup = () => {
    document.querySelectorAll("a, button").forEach((el) => {
      if (el.hasAttribute(SIGNUP_MARK)) return;
      const label = el.textContent?.trim().replace(/\s+/g, " ") ?? "";
      if (label !== "Sign in") return;
      const parent = el.parentElement;
      if (!parent || parent.querySelector(`[${SIGNUP_MARK}]`)) return;

      const signup = document.createElement("a");
      signup.setAttribute(SIGNUP_MARK, "1");
      signup.href = "/signup";
      signup.className = el.className;
      signup.textContent = "Sign up";
      parent.insertBefore(signup, el);
    });
  };

  connectLinks();
  injectSignup();
  const root = document.getElementById("root");
  if (root && root.childElementCount === 0) {
    const observer = new MutationObserver(() => {
      if (root.childElementCount > 0) {
        connectLinks();
        injectSignup();
        observer.disconnect();
      }
    });
    observer.observe(root, { childList: true });
  }
  let injectTicking = false;
  new MutationObserver(() => {
    if (injectTicking) return;
    injectTicking = true;
    requestAnimationFrame(() => {
      injectTicking = false;
      connectLinks();
      injectSignup();
    });
  }).observe(document.body, { childList: true, subtree: true });

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
  // elements instead of stable anchors. Force Sign in / Sign up to the auth routes.
  document.addEventListener("click", (event) => {
    const target = event.target.closest("a, button, [role='button']");
    if (!target) return;
    const label = target.textContent?.trim().replace(/\s+/g, " ") ?? "";
    if (label === "Sign up" || label === "Signup") {
      event.preventDefault();
      window.location.assign("/signup");
      return;
    }
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
    Mobile first fold: hide the dashboard animation and fill the screen with
    the dark hero so the next (white) section never peeks in before scroll.
  */
  const HERO_LAYOUT_ID = "cn-mobile-hero-layout";

  const ensureHeroLayoutStyle = () => {
    if (document.getElementById(HERO_LAYOUT_ID)) return;
    const style = document.createElement("style");
    style.id = HERO_LAYOUT_ID;
    style.textContent = `
      @media (max-width: 1023px) {
        .cn-mobile-hero {
          min-height: 100svh !important;
          min-height: 100dvh !important;
        }
        .cn-mobile-hero > .max-w-7xl {
          display: flex !important;
          flex-direction: column !important;
          flex: 1 1 auto !important;
          min-height: 0 !important;
          padding-top: 5.5rem !important;
          padding-bottom: 1.25rem !important;
        }
        .cn-mobile-hero .cn-hero-copy {
          display: flex !important;
          flex-direction: column !important;
          flex: 1 1 auto !important;
          min-height: 0 !important;
        }
        /* Badge, headline, and subtitle stay at the top; CTAs/trust sit at the bottom. */
        .cn-mobile-hero .cn-hero-copy > :nth-child(4) {
          margin-top: auto !important;
        }
        .cn-mobile-hero .cn-hero-visual {
          display: none !important;
        }
        .cn-mobile-hero .hero-photo {
          background-image: url("/clerknest-assets/mobilehero.png") !important;
          background-size: cover !important;
          background-position: center center !important;
          background-repeat: no-repeat !important;
        }
        /* Portrait art is already dark; keep a light scrim so type stays readable. */
        .cn-mobile-hero .hero-photo + div {
          background: linear-gradient(
            180deg,
            rgba(13, 11, 9, 0.55) 0%,
            rgba(13, 11, 9, 0.18) 45%,
            rgba(13, 11, 9, 0.58) 100%
          ) !important;
        }
      }
    `;
    document.head.appendChild(style);
  };

  const applyHeroLayout = () => {
    const hero = document.querySelector("section[data-navtheme='dark']");
    if (!hero) return;
    hero.classList.add("cn-mobile-hero");
    const inner = hero.querySelector(".max-w-7xl");
    if (!inner || inner.children.length < 2) return;
    inner.children[0].classList.add("cn-hero-copy");
    inner.children[1].classList.add("cn-hero-visual");
  };

  ensureHeroLayoutStyle();
  applyHeroLayout();
  window.addEventListener("resize", applyHeroLayout, { passive: true });
  new MutationObserver(applyHeroLayout).observe(document.body, { childList: true, subtree: true });
})();
