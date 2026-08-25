(() => {
  const destinations = new Map([
    ["ClerkNest", "/"],
    ["Sign in", "/login?redirect=/dashboard"],
    ["Sign up", "/signup"],
    ["Signup", "/signup"],
    ["Meet ClerkNest", "/try"],
    ["Try it free", "/try"],
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

  const EM_DASH = "\u2014";
  const EN_DASH = "\u2013";
  let emDashReplaceCount = 0;

  /** Strip em/en dashes from visible copy. Brand separators use pipe; clause breaks use comma. */
  const deDash = (text) => {
    if (!text || (text.indexOf(EM_DASH) === -1 && text.indexOf(EN_DASH) === -1)) return text;
    let out = text;
    const before = out;
    out = out.replace(/ClerkNest\s[\u2014\u2013]\s/g, "ClerkNest | ");
    out = out.replace(/(\d)\u2013(\d)/g, "$1-$2");
    out = out.replace(/\s[\u2014\u2013]\s/g, ", ");
    out = out.replace(/[\u2014\u2013]/g, "-");
    if (out !== before) emDashReplaceCount += 1;
    return out;
  };

  const patchEmDashes = () => {
    const titleBefore = document.title;
    const titleAfter = deDash(titleBefore);
    if (titleAfter !== titleBefore) document.title = titleAfter;

    document
      .querySelectorAll('meta[property="og:title"], meta[name="twitter:title"], meta[name="title"]')
      .forEach((el) => {
        const content = el.getAttribute("content");
        if (!content) return;
        const next = deDash(content);
        if (next !== content) el.setAttribute("content", next);
      });

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return NodeFilter.FILTER_REJECT;
        const value = node.nodeValue;
        if (!value || (value.indexOf(EM_DASH) === -1 && value.indexOf(EN_DASH) === -1)) {
          return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const next = deDash(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
    });
  };

  const SIGNUP_MARK = "data-cn-signup";
  const HERO_SIGNUP_MARK = "data-cn-hero-signup";
  const HEADER_TRY_MARK = "data-cn-header-try";

  /** Header CTA — match live Next.js site-header: pink button → Try it free. */
  const renameHeaderTryCta = () => {
    document.querySelectorAll("header a, header button").forEach((el) => {
      if (el.hasAttribute(HEADER_TRY_MARK)) return;
      const label = el.textContent?.trim().replace(/\s+/g, " ") ?? "";
      if (label !== "Meet ClerkNest") return;
      el.setAttribute(HEADER_TRY_MARK, "1");
      el.textContent = "Try it free";
      if (el.tagName === "A") el.setAttribute("href", "/try");
    });
  };

  /** Drop Sign up beside Sign in in the header — it belongs in the hero. */
  const removeHeaderSignup = () => {
    document.querySelectorAll(`[${SIGNUP_MARK}]`).forEach((el) => el.remove());
    document.querySelectorAll("header a, header button").forEach((el) => {
      const label = el.textContent?.trim().replace(/\s+/g, " ") ?? "";
      if (label === "Sign up" || label === "Signup") el.remove();
    });
  };

  /**
   * First-view hero: replace "See how it works" with Sign up → /signup.
   * Prebuilt bundle — don't edit minified JSX; patch the live DOM instead.
   */
  const heroSignupInsteadOfHowItWorks = () => {
    document.querySelectorAll("a, button").forEach((el) => {
      if (el.hasAttribute(HERO_SIGNUP_MARK)) return;
      const label = el.textContent?.trim().replace(/\s+/g, " ") ?? "";
      if (!/^See how it works/i.test(label)) return;
      // Keep this in the hero copy column only (not footer / elsewhere).
      if (el.closest("header") || el.closest("footer")) return;

      el.setAttribute(HERO_SIGNUP_MARK, "1");
      el.textContent = "Sign up";
      if (el.tagName === "A") el.setAttribute("href", "/signup");
    });
  };

  /**
   * Mobile first fold: Manychat-style budget.
   * Keep badge → headline → sub → CTAs → platform strip.
   * Still drop stars / extra chrome that crowds the first view.
   */
  const quietMobileHeroChrome = () => {
    if (!window.matchMedia("(max-width: 1023px)").matches) return;
    const copy = document.querySelector(".cn-mobile-hero .cn-hero-copy");
    if (!copy) return;
    const kids = Array.from(copy.children);
    const ctaIdx = kids.findIndex(
      (el) =>
        (el.textContent || "").includes("Meet ClerkNest") ||
        (el.textContent || "").includes("Try it free"),
    );
    if (ctaIdx < 0) return;

    kids.forEach((el, i) => {
      const text = (el.textContent || "").replace(/\s+/g, " ");
      const isBadge = /AI Employee/i.test(text) && /24\/7/.test(text);
      const isPlatformStrip = /Social Media Automation Platform/i.test(text);
      if (isBadge) el.setAttribute("data-cn-hero-badge", "1");
      if (isPlatformStrip) el.setAttribute("data-cn-hero-platforms", "1");
      if (i === ctaIdx - 1 && el.tagName === "P") el.setAttribute("data-cn-hero-sub", "1");

      const isCtaOrCopy = i === ctaIdx || i === ctaIdx - 1 || i === ctaIdx - 2;
      const keep = isCtaOrCopy || isBadge || isPlatformStrip;

      if (!keep) {
        el.style.setProperty("display", "none", "important");
        el.setAttribute("data-cn-mobile-chrome-hidden", "1");
      } else if (el.hasAttribute("data-cn-mobile-chrome-hidden")) {
        el.style.removeProperty("display");
        el.removeAttribute("data-cn-mobile-chrome-hidden");
      }
    });
    formatHeroSubtext();
  };

  /**
   * Mobile hero sub: force a clean two-line break before "across" so line 1
   * ends at "appointments" and line 2 starts with "across WhatsApp…".
   * Desktop keeps the bundle's original single-flow copy.
   */
  const HERO_SUB_FALLBACK =
    "Answers every DM, takes orders and books appointments across WhatsApp, Instagram, Messenger and web chat.";
  const HERO_SUB_LINE2_SHORT =
    "across WhatsApp, Instagram, Messenger & web chat.";
  let heroSubOriginal = null;

  const fitHeroSubtext = () => {
    const sub = document.querySelector(".cn-mobile-hero .cn-hero-copy [data-cn-hero-sub]");
    if (!sub || !window.matchMedia("(max-width: 1023px)").matches) {
      sub?.style.removeProperty("font-size");
      return;
    }
    const l1 = sub.querySelector(".cn-hero-sub-l1");
    const l2 = sub.querySelector(".cn-hero-sub-l2");
    if (!l1 || !l2) return;

    const lineCount = (el) => {
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 16;
      return el.getBoundingClientRect().height / lh;
    };

    const tryFit = (line2Text) => {
      l2.textContent = line2Text;
      sub.style.removeProperty("font-size");
      let size = parseFloat(getComputedStyle(sub).fontSize);
      const floor = 10;
      while (size > floor && (lineCount(l1) > 1.12 || lineCount(l2) > 1.12)) {
        size -= 0.5;
        sub.style.setProperty("font-size", `${size}px`, "important");
      }
      return lineCount(l1) <= 1.12 && lineCount(l2) <= 1.12;
    };

    const line2Full = heroSubOriginal.replace(/^[\s\S]*?\bacross\b\s*/i, "across ");
    if (!tryFit(line2Full)) tryFit(HERO_SUB_LINE2_SHORT);
  };

  const formatHeroSubtext = () => {
    const sub = document.querySelector(".cn-mobile-hero .cn-hero-copy [data-cn-hero-sub]");
    if (!sub) return;
    if (heroSubOriginal === null) {
      heroSubOriginal = (sub.textContent || HERO_SUB_FALLBACK).replace(/\s+/g, " ").trim();
    }
    const mobile = window.matchMedia("(max-width: 1023px)").matches;
    if (mobile) {
      const line1 = heroSubOriginal.replace(/\s+across[\s\S]*$/i, "").trim();
      const line2 = heroSubOriginal.replace(/^[\s\S]*?\bacross\b\s*/i, "across ");
      const withBreak =
        `<span class="cn-hero-sub-l1">${line1}</span>` +
        `<span class="cn-hero-sub-l2">${line2}</span>`;
      if (sub.innerHTML !== withBreak) sub.innerHTML = withBreak;
      requestAnimationFrame(() => fitHeroSubtext());
      return;
    }
    sub.style.removeProperty("font-size");
    if (sub.textContent !== heroSubOriginal) sub.textContent = heroSubOriginal;
  };

  /**
   * Live Manychat-style bubble demo — every first-view dashboard showcase
   * as transparent bubbles + chips (catalogue, order, pay, confirm, handoff,
   * booking, deposit, multi-channel). Same script on mobile + desktop.
   */
  const BUBBLE_SCENES = [
    {
      channel: "WhatsApp",
      accent: "#25D366",
      steps: [
        {
          hold: 2100,
          user: "Sea Green Maxi still in stock? Size M",
          ai: "Yes, 2 left in Medium, $29. Want me to reserve one?",
          chip: "Catalogue · in stock",
        },
        {
          hold: 2200,
          user: "Yes please, can I pay by card?",
          ai: "Reserved. Here’s your secure card link.",
          chip: "Order #1047 · $29",
        },
        {
          hold: 2300,
          user: "Paid ✅",
          ai: "Payment received. Order confirmed. Ships today.",
          chip: "Paid · confirmed · stock −1",
        },
      ],
    },
    {
      channel: "Instagram",
      accent: "#E4405F",
      steps: [
        {
          hold: 2200,
          user: "My kurta arrived with a small tear",
          ai: "I'm so sorry, looping in the owner now.",
          chip: "Handoff → Sarah",
        },
        {
          hold: 2300,
          user: "Oh wow, thank you so much 🙏",
          ai: "Sarah here. Replacement ships today, free of charge.",
          chip: "Owner replied · 41s",
        },
      ],
    },
    {
      channel: "Messenger",
      accent: "#0084FF",
      steps: [
        {
          hold: 2100,
          user: "How much for a cut + colour? Anything Saturday?",
          ai: "Cut + colour is $25. Saturday I have 11:00 or 2:30 free.",
          chip: "Availability · Sat open",
        },
        {
          hold: 2300,
          user: "2:30 works for me",
          ai: "Booked, Sat 2:30 PM with Amy. A $5 deposit holds the slot.",
          chip: "Booking · Sat 2:30 · $5 deposit",
        },
      ],
    },
    {
      channel: "Website",
      accent: "#4F46E5",
      steps: [
        {
          hold: 2100,
          user: "Do you deliver to Chicago?",
          ai: "We do, 3 to 4 days, free over $20.",
          chip: "Website chat · one inbox",
        },
        {
          hold: 2200,
          user: "Great, can someone call me about a bulk order?",
          ai: "Got it. Marked as a warm lead, someone will call you today.",
          chip: "Lead qualified · call queued",
        },
      ],
    },
  ];

  let bubbleDemo = {
    timer: null,
    scene: 0,
    step: 0,
    phase: 0,
    root: null,
    running: false,
    history: [],
  };

  const stopBubbleDemo = () => {
    if (bubbleDemo.timer) {
      clearTimeout(bubbleDemo.timer);
      bubbleDemo.timer = null;
    }
    bubbleDemo.running = false;
  };

  const isDesktopBubbleRoot = (root) =>
    !!root?.hasAttribute("data-cn-desktop-bubbles") ||
    !!root?.hasAttribute("data-cn-mobile-bubbles");

  const CUSTOMER_AVATAR_URL = "/clerknest-assets/customer-avatar-round.png";
  const AI_AVATAR_URL = "/clerknest-assets/logo-avatar.png";

  const customerAvatarHtml = `
    <img class="cn-avatar-img" src="${CUSTOMER_AVATAR_URL}" alt="" width="40" height="40" decoding="async" />`;

  const aiAvatarHtml = `
    <img class="cn-avatar-img" src="${AI_AVATAR_URL}" alt="ClerkNest" width="40" height="40" decoding="async" />`;

  const PLATFORM_ICONS = {
    WhatsApp: `<svg class="cn-channel-logo" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="#25D366" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.263.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885M20.52 3.449C18.24 1.245 15.24 0 12.045 0 5.463 0 .104 5.334.101 11.892c0 2.096.549 4.14 1.595 5.945L0 24l6.335-1.652a12.062 12.062 0 005.71 1.447h.006c6.585 0 11.946-5.335 11.949-11.893a11.821 11.821 0 00-3.481-8.413z"/></svg>`,
    Instagram: `<svg class="cn-channel-logo" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><defs><linearGradient id="cnIg" x1="0" y1="24" x2="24" y2="0"><stop stop-color="#f58529"/><stop offset=".5" stop-color="#dd2a7b"/><stop offset="1" stop-color="#8134af"/></linearGradient></defs><path fill="url(#cnIg)" d="M7.8 2h8.4C19.4 2 22 4.6 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8C4.6 22 2 19.4 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2Zm-.2 2A3.6 3.6 0 0 0 4 7.6v8.8A3.6 3.6 0 0 0 7.6 20h8.8a3.6 3.6 0 0 0 3.6-3.6V7.6A3.6 3.6 0 0 0 16.4 4H7.6Zm9.65 1.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/></svg>`,
    Messenger: `<svg class="cn-channel-logo" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><defs><linearGradient id="cnMsg" x1="0" y1="24" x2="24" y2="0"><stop stop-color="#00B2FF"/><stop offset="1" stop-color="#006AFF"/></linearGradient></defs><path fill="url(#cnMsg)" d="M12 2C6.36 2 2 6.13 2 11.7c0 2.9 1.19 5.4 3.14 7.14V22l3.2-1.76c1.1.3 2.26.46 3.46.46 5.64 0 10.2-4.13 10.2-9.7C22 6.13 17.64 2 12 2Zm1.01 12.98-2.6-2.77-5.07 2.77L10.9 9.3l2.66 2.77 5.01-2.77-5.56 5.68Z"/></svg>`,
    Website: `<svg class="cn-channel-logo" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#4F46E5"/><path fill="#fff" d="M12 4.2a7.8 7.8 0 0 0 0 15.6V4.2Zm0 0c2.1 0 4.2 3.5 4.2 7.8S14.1 19.8 12 19.8 7.8 16.3 7.8 12 9.9 4.2 12 4.2Zm-7.2 7h14.4v1.6H4.8V11.2Z"/></svg>`,
  };

  const setChannelPill = (el, scene) => {
    if (!el || !scene) return;
    el.style.setProperty("--cn-channel-accent", scene.accent);
    const icon = PLATFORM_ICONS[scene.channel] || PLATFORM_ICONS.WhatsApp;
    el.innerHTML = `${icon}<span>${scene.channel}</span>`;
  };

  const makeBubbleRow = (kind, text, pop) => {
    const row = document.createElement("div");
    row.className = `cn-msg-row cn-msg-row-${kind}${pop ? " cn-bubble-pop" : ""}`;

    if (kind === "chip") {
      row.innerHTML = `<div class="cn-bubble-chip cn-action-chip">${text}</div>`;
      return row;
    }

    if (kind === "typing-user") {
      row.innerHTML = `
        <div class="cn-avatar cn-avatar-user" title="Customer">${customerAvatarHtml}</div>
        <div class="cn-msg-body">
          <div class="cn-bubble cn-bubble-typing cn-bubble-typing-user" aria-hidden="true">
            <span></span><span></span><span></span>
          </div>
        </div>
      `;
      return row;
    }

    if (kind === "typing" || kind === "typing-ai") {
      row.innerHTML = `
        <div class="cn-msg-body">
          <div class="cn-bubble cn-bubble-typing cn-bubble-typing-ai" aria-hidden="true">
            <span></span><span></span><span></span>
          </div>
        </div>
        <div class="cn-avatar cn-avatar-ai" title="ClerkNest AI">${aiAvatarHtml}</div>
      `;
      return row;
    }

    if (kind === "user") {
      row.innerHTML = `
        <div class="cn-avatar cn-avatar-user" title="Customer">${customerAvatarHtml}</div>
        <div class="cn-msg-body">
          <div class="cn-bubble cn-bubble-user">${text}</div>
        </div>
      `;
      return row;
    }

    row.innerHTML = `
      <div class="cn-msg-body">
        <div class="cn-bubble cn-bubble-ai" role="status"><p>${text}</p></div>
      </div>
      <div class="cn-avatar cn-avatar-ai" title="ClerkNest AI">${aiAvatarHtml}</div>
    `;
    return row;
  };

  /** Desktop: growing thread (up to 5). Mobile first-view: up to 3 bubbles total (typing counts). */
  const renderDesktopThread = (root, scene, opts = {}) => {
    const channel = root.querySelector("[data-cn-channel]");
    const stage = root.querySelector("[data-cn-stage]");
    if (!channel || !stage) return;

    setChannelPill(channel, scene);

    const isMobile = root.hasAttribute("data-cn-mobile-bubbles");
    const isLandscapeMobile = window.matchMedia("(max-width: 1023px) and (max-height: 520px)").matches;
    const maxVisible = isMobile ? (isLandscapeMobile ? 2 : 3) : 5;
    const historyCap = opts.typing && isMobile ? maxVisible - 1 : maxVisible;
    const items = bubbleDemo.history.slice(-historyCap);
    const historyStart = bubbleDemo.history.length - items.length;
    stage.replaceChildren();
    items.forEach((item, i) => {
      const pop = opts.popIndex === historyStart + i;
      stage.appendChild(makeBubbleRow(item.kind, item.text, pop));
    });
    if (opts.typing === "user") {
      stage.appendChild(makeBubbleRow("typing-user", "", true));
    } else if (opts.typing === "ai") {
      stage.appendChild(makeBubbleRow("typing-ai", "", true));
    }
  };

  /** ManyChat-style: customer typing → user → AI typing → AI → chip. */
  const renderBubblePhase = (root, scene, step, phase) => {
    if (isDesktopBubbleRoot(root)) {
      let typing = null;
      if (phase === 1) typing = "user";
      if (phase === 3) typing = "ai";
      renderDesktopThread(root, scene, {
        typing,
        popIndex: bubbleDemo.history.length - 1,
      });
      return;
    }

    const channel = root.querySelector("[data-cn-channel]");
    const stage = root.querySelector("[data-cn-stage]");
    const userTyping = root.querySelector("[data-cn-user-typing]");
    const user = root.querySelector("[data-cn-user]");
    const typing = root.querySelector("[data-cn-typing]");
    const ai = root.querySelector("[data-cn-ai]");
    const chip = root.querySelector("[data-cn-chip]");
    if (!channel || !stage || !user || !typing || !ai || !chip) return;

    setChannelPill(channel, scene);

    user.textContent = step.user;
    ai.querySelector("p").textContent = step.ai;
    if (step.chip) {
      chip.textContent = step.chip;
      chip.hidden = false;
    } else {
      chip.hidden = true;
      chip.textContent = "";
    }

    stage.dataset.phase = String(phase);
    const show = (el, on) => {
      if (!el) return;
      el.hidden = !on;
    };
    // Mobile: keep thread light — typing + one partner bubble max.
    show(userTyping, phase === 1);
    show(user, phase === 2 || phase === 3);
    show(typing, phase === 3);
    show(ai, phase >= 4);
    show(chip, phase >= 5 && !!step.chip);

    const pop = (el) => {
      if (!el || el.hidden) return;
      el.classList.remove("cn-bubble-pop");
      void el.offsetWidth;
      el.classList.add("cn-bubble-pop");
    };
    if (phase === 1) pop(userTyping);
    if (phase === 2) pop(user);
    if (phase === 3) pop(typing);
    if (phase === 4) pop(ai);
    if (phase === 5 && step.chip) pop(chip);
  };

  const scheduleBubble = (ms, fn) => {
    bubbleDemo.timer = setTimeout(fn, ms);
  };

  const pushHistory = (kind, text) => {
    bubbleDemo.history.push({ kind, text });
  };

  const tickBubbleDemo = () => {
    const root = bubbleDemo.root;
    if (!root || !root.isConnected) return stopBubbleDemo();

    const scene = BUBBLE_SCENES[bubbleDemo.scene];
    const step = scene.steps[bubbleDemo.step];
    const phase = bubbleDemo.phase;
    const desktop = isDesktopBubbleRoot(root);

    if (desktop) {
      // Readable pace: customer types → msg → AI types → reply → chip → brief hold
      if (phase === 0) {
        bubbleDemo.phase = 1;
        scheduleBubble(320, tickBubbleDemo);
        return;
      }
      if (phase === 1) {
        renderBubblePhase(root, scene, step, 1);
        bubbleDemo.phase = 2;
        scheduleBubble(1100, tickBubbleDemo);
        return;
      }
      if (phase === 2) {
        pushHistory("user", step.user);
        renderBubblePhase(root, scene, step, 2);
        bubbleDemo.phase = 3;
        scheduleBubble(520, tickBubbleDemo);
        return;
      }
      if (phase === 3) {
        renderBubblePhase(root, scene, step, 3);
        bubbleDemo.phase = 4;
        scheduleBubble(1200, tickBubbleDemo);
        return;
      }
      if (phase === 4) {
        pushHistory("ai", step.ai);
        renderBubblePhase(root, scene, step, 4);
        if (step.chip) {
          bubbleDemo.phase = 5;
          scheduleBubble(720, tickBubbleDemo);
          return;
        }
      } else if (phase === 5 && step.chip) {
        pushHistory("chip", step.chip);
        renderBubblePhase(root, scene, step, 5);
      } else {
        renderBubblePhase(root, scene, step, phase);
      }

      const hold = step.hold ?? 2200;
      scheduleBubble(hold, () => {
        bubbleDemo.phase = 0;
        bubbleDemo.step += 1;
        if (bubbleDemo.step >= scene.steps.length) {
          bubbleDemo.step = 0;
          bubbleDemo.scene = (bubbleDemo.scene + 1) % BUBBLE_SCENES.length;
          bubbleDemo.history = [];
        }
        tickBubbleDemo();
      });
      return;
    }

    renderBubblePhase(root, scene, step, phase);

    if (phase === 0) {
      bubbleDemo.phase = 1;
      scheduleBubble(320, tickBubbleDemo);
      return;
    }
    if (phase === 1) {
      bubbleDemo.phase = 2;
      scheduleBubble(1100, tickBubbleDemo);
      return;
    }
    if (phase === 2) {
      bubbleDemo.phase = 3;
      scheduleBubble(520, tickBubbleDemo);
      return;
    }
    if (phase === 3) {
      bubbleDemo.phase = 4;
      scheduleBubble(1200, tickBubbleDemo);
      return;
    }
    if (phase === 4 && step.chip) {
      bubbleDemo.phase = 5;
      scheduleBubble(720, tickBubbleDemo);
      return;
    }

    const hold = step.hold ?? 2200;
    scheduleBubble(hold, () => {
      bubbleDemo.phase = 0;
      bubbleDemo.step += 1;
      if (bubbleDemo.step >= scene.steps.length) {
        bubbleDemo.step = 0;
        bubbleDemo.scene = (bubbleDemo.scene + 1) % BUBBLE_SCENES.length;
      }
      tickBubbleDemo();
    });
  };

  const startBubbleDemo = (stack) => {
    if (bubbleDemo.running && bubbleDemo.root === stack) return;
    stopBubbleDemo();
    bubbleDemo.root = stack;
    bubbleDemo.scene = 0;
    bubbleDemo.step = 0;
    bubbleDemo.phase = 0;
    bubbleDemo.history = [];
    bubbleDemo.running = true;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const scene = BUBBLE_SCENES[0];
      const step = scene.steps[0];
      if (isDesktopBubbleRoot(stack)) {
        bubbleDemo.history = [
          { kind: "user", text: step.user },
          { kind: "ai", text: step.ai },
        ];
        if (step.chip) bubbleDemo.history.push({ kind: "chip", text: step.chip });
        renderDesktopThread(stack, scene);
      } else {
        renderBubblePhase(stack, scene, step, 4);
      }
      return;
    }
    tickBubbleDemo();
  };

  const bubbleStackMarkup = (desktop) => {
    if (desktop) {
      return `
        <div class="cn-channel-pill" data-cn-channel>WhatsApp</div>
        <div class="cn-bubble-stage cn-desktop-stage" data-cn-stage data-phase="0"></div>
      `;
    }
    return `
      <div class="cn-channel-pill" data-cn-channel>WhatsApp</div>
      <div class="cn-bubble-stage" data-cn-stage data-phase="0">
        <div class="cn-bubble cn-bubble-typing cn-bubble-typing-user cn-bubble-pop" data-cn-user-typing hidden aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
        <div class="cn-bubble cn-bubble-user cn-bubble-pop" data-cn-user hidden></div>
        <div class="cn-bubble cn-bubble-typing cn-bubble-typing-ai cn-bubble-pop" data-cn-typing hidden aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
        <div class="cn-bubble cn-bubble-ai cn-bubble-pop" data-cn-ai hidden role="status">
          <p></p>
        </div>
        <div class="cn-bubble-chip cn-bubble-pop" data-cn-chip hidden></div>
      </div>
    `;
  };

  /** Hide legacy glass dashboard on desktop; bubbles take its place. */
  const hideDesktopDashboardPanel = (visual, hide) => {
    if (!visual) return;
    Array.from(visual.children).forEach((child) => {
      if (child.hasAttribute("data-cn-desktop-bubbles") || child.hasAttribute("data-cn-mobile-bubbles")) return;
      if (hide) {
        child.style.setProperty("display", "none", "important");
        child.setAttribute("data-cn-dashboard-hidden", "1");
      } else if (child.hasAttribute("data-cn-dashboard-hidden")) {
        child.style.removeProperty("display");
        child.removeAttribute("data-cn-dashboard-hidden");
      }
    });
  };

  const ensureMobileChatBubbles = () => {
    const hero = document.querySelector(".cn-mobile-hero");
    if (!hero) return;
    const visual = hero.querySelector(".cn-hero-visual");
    const isMobile = window.matchMedia("(max-width: 1023px)").matches;

    let mobileStack = hero.querySelector("[data-cn-mobile-bubbles]");
    let desktopStack = visual?.querySelector("[data-cn-desktop-bubbles]");

    if (isMobile) {
      hideDesktopDashboardPanel(visual, false);
      document.querySelector(".cn-mobile-hero > [data-cn-desktop-bubbles]")?.remove();
      desktopStack?.remove();
      if (mobileStack && mobileStack.querySelector("[data-cn-user-typing]")) {
        stopBubbleDemo();
        bubbleDemo.root = null;
        mobileStack.remove();
        mobileStack = null;
      }
      if (!mobileStack) {
        mobileStack = document.createElement("div");
        mobileStack.setAttribute("data-cn-mobile-bubbles", "1");
        mobileStack.className = "cn-mobile-bubbles";
        mobileStack.innerHTML = bubbleStackMarkup(true);
        hero.appendChild(mobileStack);
      }
      startBubbleDemo(mobileStack);
      return;
    }

    mobileStack?.remove();
    hideDesktopDashboardPanel(visual, true);
    if (!visual) return;

    // Clear any leftover stack from older mounts inside .cn-hero-visual.
    visual.querySelectorAll("[data-cn-desktop-bubbles]").forEach((el) => el.remove());

    const mount = hero;
    desktopStack = mount.querySelector("[data-cn-desktop-bubbles]");
    if (desktopStack && desktopStack.getAttribute("data-cn-bubble-v") !== "5") {
      desktopStack.remove();
      desktopStack = null;
      stopBubbleDemo();
      bubbleDemo.root = null;
    }
    if (!desktopStack) {
      desktopStack = document.createElement("div");
      desktopStack.setAttribute("data-cn-desktop-bubbles", "1");
      desktopStack.setAttribute("data-cn-bubble-v", "5");
      desktopStack.className = "cn-desktop-bubbles";
      desktopStack.innerHTML = bubbleStackMarkup(true);
      mount.appendChild(desktopStack);
    }
    startBubbleDemo(desktopStack);
  };

  /**
   * "The till is closed. Your phone isn't." dark section (further down the
   * page — the second `section[data-navtheme='dark']`, not the first-view
   * hero). The bundle's own JSX nests the "ClerkNest · just now" proof card
   * as a direct child of the *section itself* — a sibling of the copy
   * column's wrapper, not nested inside it — and the section is a row flex
   * container (`flex items-center`). Desktop hides that by absolutely
   * positioning the card bottom-right, which takes it out of flex flow
   * entirely. Flipping only `position` to `relative` (an earlier attempt)
   * doesn't fix mobile: it turns the card into a *second flex item* of
   * that row, and `items-center` then vertically centers it mid-section,
   * landing it on top of the body copy instead of stacking below the CTA.
   * The real fix has to change the card's place in the tree, not just its
   * CSS position — so on mobile this moves the card node itself to be the
   * last child of the copy column (`.max-w-xl`), right after the CTA, and
   * moves it back to its original spot (original parent + next-sibling,
   * remembered on first run) once the viewport leaves mobile. Scoped to
   * this card's own unique class combination (verified unique in the
   * bundle), so every other section/agent's work is untouched.
   */
  // Unique among every `data-navtheme="dark"` section on the page (hero and
  // the footer-area dark sections don't ship this exact class combo) —
  // shared by the mobile layout rules below.
  const NIGHT_SHIFT_SECTION_SELECTOR = 'section[data-navtheme="dark"][class*="min-h-[92vh]"]';
  const NIGHT_SHIFT_CARD_SELECTOR = '[class*="max-w-[300px]"][class*="bg-obsidian/75"]';
  const NIGHT_SHIFT_CARD_PROPS = ["position", "inset", "top", "right", "bottom", "left", "max-width", "width", "margin", "padding", "box-sizing"];
  const nightShiftCardHome = { parent: null, next: null };

  const layoutNightShiftCard = () => {
    const card = document.querySelector(NIGHT_SHIFT_CARD_SELECTOR);
    if (!card) return;

    if (!nightShiftCardHome.parent) {
      nightShiftCardHome.parent = card.parentElement;
      nightShiftCardHome.next = card.nextElementSibling;
    }

    if (window.matchMedia("(max-width: 1023px)").matches) {
      const copy = nightShiftCardHome.parent && nightShiftCardHome.parent.querySelector(".max-w-xl");
      if (copy && card.parentElement !== copy) copy.appendChild(card);

      card.style.setProperty("position", "static", "important");
      card.style.setProperty("inset", "auto", "important");
      card.style.setProperty("max-width", "none", "important");
      card.style.setProperty("width", "100%", "important");
      card.style.setProperty("box-sizing", "border-box", "important");
      // Clear separation from the CTA above without the section ballooning
      // in height — a distinct "proof" panel, not a caption bolted onto
      // the button, but not padded like empty dead space either.
      card.style.setProperty("margin", "1.5rem 0 0", "important");
      card.style.setProperty("padding", "1rem", "important");
    } else {
      if (nightShiftCardHome.parent && card.parentElement !== nightShiftCardHome.parent) {
        if (nightShiftCardHome.next && nightShiftCardHome.next.parentElement === nightShiftCardHome.parent) {
          nightShiftCardHome.parent.insertBefore(card, nightShiftCardHome.next);
        } else {
          nightShiftCardHome.parent.appendChild(card);
        }
      }
      NIGHT_SHIFT_CARD_PROPS.forEach((prop) => card.style.removeProperty(prop));
    }
  };

  /**
   * Body copy under "The till is closed. Your phone isn't." reads fine at
   * desktop's roomy max-w-md column, but the same sentence (~200 characters,
   * three clauses) forces 5+ cramped lines in a ~320px-wide mobile column
   * even at a small font. Rather than shrink it past comfortable reading
   * size, trim it to the same idea in one punchier sentence that actually
   * fits a clean 3-line block on mobile. Desktop keeps the original copy —
   * this only swaps text below the 1024px breakpoint, restoring the
   * original if the viewport grows back to desktop width.
   */
  const NIGHT_SHIFT_COPY_SELECTOR = '[class*="text-ivory/70"][class*="max-w-md"]';
  const NIGHT_SHIFT_COPY_MOBILE =
    "Midnight questions. Missed orders. One more \u201cprice?\u201d before bed. ClerkNest takes the night shift, so you don't have to.";
  let nightShiftCopyOriginal = null;

  const shortenNightShiftCopy = () => {
    const copy = document.querySelector(NIGHT_SHIFT_COPY_SELECTOR);
    if (!copy) return;
    if (nightShiftCopyOriginal === null) nightShiftCopyOriginal = copy.textContent;

    const mobile = window.matchMedia("(max-width: 1023px)").matches;
    const target = mobile ? NIGHT_SHIFT_COPY_MOBILE : nightShiftCopyOriginal;
    if (copy.textContent !== target) copy.textContent = target;
  };

  /*
    "One employee. Native everywhere." channel demo — pin the section while
    scroll progress advances WhatsApp → Instagram DMs → Messenger → Website
    Chat (and reverses on the way up). Classic tall scrub track + sticky
    pane; platform changes reuse the existing tab button clicks so the React
    chat mockup stays the source of truth. Mobile additionally compacts tab
    labels so all four fit on one row.
  */
  const PLATFORM_SCRUB_STYLE_ID = "cn-platform-scrub-v3";
  /** Canonical order; mobile may show shorter aliases (see matchers). */
  const PLATFORM_SCRUB_LABELS = ["WhatsApp", "Instagram DMs", "Messenger", "Website Chat"];
  const PLATFORM_SCRUB_MATCHERS = [
    ["WhatsApp"],
    ["Instagram DMs", "Instagram"],
    ["Messenger"],
    ["Website Chat", "Web"],
  ];
  /** Short mobile labels so all four fit on one ~360px row. */
  const PLATFORM_SCRUB_MOBILE_LABELS = ["WhatsApp", "Instagram", "Messenger", "Web"];
  const PLATFORM_SCRUB_COUNT = PLATFORM_SCRUB_LABELS.length;
  /** Viewport-heights of scroll per platform step (track = count * this). */
  const PLATFORM_SCRUB_VH_PER = 0.85;
  const PLATFORM_SCRUB_HYSTERESIS = 0.12;

  let platformScrubIndex = 0;
  let platformScrubWired = false;
  /** Stable vh for scrub math — ignore mobile URL-bar height wobble. */
  let lockedScrubVh = 0;
  let lockedScrubWidth = 0;

  const getStableScrubVh = () => {
    const width = window.innerWidth;
    if (!lockedScrubVh || width !== lockedScrubWidth) {
      lockedScrubVh = window.innerHeight || 1;
      lockedScrubWidth = width;
    }
    return lockedScrubVh;
  };

  const findChannelDemoSection = () => {
    const headings = document.querySelectorAll("h2");
    for (const h of headings) {
      const text = (h.textContent || "").replace(/\s+/g, " ");
      if (text.includes("Native everywhere")) return h.closest("section");
    }
    return null;
  };

  const findPlatformButtons = (section) => {
    if (!section) return [];
    const byIndex = new Array(PLATFORM_SCRUB_COUNT).fill(null);
    section.querySelectorAll("button").forEach((btn) => {
      const label = (btn.textContent || "").trim().replace(/\s+/g, " ");
      for (let i = 0; i < PLATFORM_SCRUB_MATCHERS.length; i++) {
        if (byIndex[i]) continue;
        if (PLATFORM_SCRUB_MATCHERS[i].includes(label)) {
          byIndex[i] = btn;
          break;
        }
      }
    });
    return byIndex.filter(Boolean);
  };

  /**
   * Compact long tab labels on mobile so WhatsApp / Instagram / Messenger /
   * Web all fit on one row. Preserves the icon SVG; only rewrites text nodes.
   * React remounts may restore long labels — re-run from ensurePlatformScrub.
   */
  const compactPlatformTabLabels = (section) => {
    if (!section) return;
    const buttons = findPlatformButtons(section);
    if (buttons.length !== PLATFORM_SCRUB_COUNT) return;
    const mobilePhone = window.matchMedia("(max-width: 639px)").matches;
    buttons.forEach((btn, i) => {
      const want = mobilePhone ? PLATFORM_SCRUB_MOBILE_LABELS[i] : PLATFORM_SCRUB_LABELS[i];
      const current = (btn.textContent || "").trim().replace(/\s+/g, " ");
      if (current === want) return;
      const icon = btn.querySelector("svg");
      btn.textContent = "";
      if (icon) btn.appendChild(icon);
      btn.appendChild(document.createTextNode(want));
    });
  };

  const platformButtonLooksActive = (btn) => {
    const cls = btn.className || "";
    return cls.includes("bg-obsidian") || cls.includes("text-ivory");
  };

  /**
   * Drive the React tab without focusing the button (focus scrolls it into
   * view and fights the sticky scrub) and without letting any click-time
   * layout shift move window.scrollY.
   */
  const activatePlatformByIndex = (section, index) => {
    const buttons = findPlatformButtons(section);
    if (buttons.length !== PLATFORM_SCRUB_COUNT) return;
    const btn = buttons[index];
    if (!btn || platformButtonLooksActive(btn)) return;
    const y = window.scrollY;
    const x = window.scrollX;
    try {
      btn.focus({ preventScroll: true });
    } catch (_) {
      /* older WebKit */
    }
    btn.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, view: window }),
    );
    if (window.scrollY !== y || window.scrollX !== x) {
      window.scrollTo(x, y);
    }
    // React may restore long labels on re-render — re-compact next frame.
    requestAnimationFrame(() => compactPlatformTabLabels(section));
  };

  const unwrapPlatformScrub = (section) => {
    const track = section && section.closest("[data-cn-platform-scrub='track']");
    if (!track) return;
    const parent = track.parentNode;
    if (!parent) return;
    parent.insertBefore(section, track);
    track.remove();
  };

  const ensurePlatformScrubStyle = () => {
    ["cn-platform-scrub-v1", "cn-platform-scrub-v2"].forEach((id) =>
      document.getElementById(id)?.remove(),
    );
    if (document.getElementById(PLATFORM_SCRUB_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = PLATFORM_SCRUB_STYLE_ID;
    style.textContent = `
      [data-cn-platform-scrub="track"] {
        position: relative;
        display: block;
      }
      [data-cn-platform-scrub="sticky"] {
        position: sticky;
        top: 0;
        z-index: 1;
        /* min-height locked in px via JS (stable vh) so URL-bar
           collapse/expand on scroll-direction change can't resize the
           sticky pane and jump progress. */
        display: flex;
        flex-direction: column;
        justify-content: center;
        box-sizing: border-box;
      }
      @media (max-width: 1023px) {
        [data-cn-platform-scrub="sticky"] > section {
          /* Keep the pinned pane readable on short phones without the
             desktop py-20 eating the chat mockup. */
          padding-top: 3.25rem !important;
          padding-bottom: 1.75rem !important;
          width: 100%;
          box-sizing: border-box;
        }
      }
    `;
    document.head.appendChild(style);
  };

  const syncPlatformScrub = () => {
    const section = findChannelDemoSection();
    if (!section) return;
    compactPlatformTabLabels(section);
    const track = section.closest("[data-cn-platform-scrub='track']");
    if (!track) return;

    // Use locked vh — live innerHeight jumps when the mobile URL bar
    // shows/hides on direction change and would rewrite progress mid-scrub.
    const scrollable = track.offsetHeight - getStableScrubVh();
    if (scrollable <= 0) return;

    const rect = track.getBoundingClientRect();
    const progress = Math.min(1, Math.max(0, -rect.top / scrollable));

    // Equal segments across the track; hysteresis avoids flicker at edges.
    const segment = 1 / PLATFORM_SCRUB_COUNT;
    let next = Math.min(
      PLATFORM_SCRUB_COUNT - 1,
      Math.floor(progress * PLATFORM_SCRUB_COUNT + 1e-6),
    );
    if (progress >= 1 - 1e-6) next = PLATFORM_SCRUB_COUNT - 1;

    if (next > platformScrubIndex) {
      const threshold = (platformScrubIndex + 1) * segment - PLATFORM_SCRUB_HYSTERESIS * segment;
      if (progress < threshold) next = platformScrubIndex;
    } else if (next < platformScrubIndex) {
      const threshold = platformScrubIndex * segment + PLATFORM_SCRUB_HYSTERESIS * segment;
      if (progress > threshold) next = platformScrubIndex;
    }

    if (next === platformScrubIndex) return;
    platformScrubIndex = next;
    activatePlatformByIndex(section, next);
  };

  const ensurePlatformScrub = () => {
    ensurePlatformScrubStyle();
    const section = findChannelDemoSection();
    if (!section) return;

    compactPlatformTabLabels(section);

    const buttons = findPlatformButtons(section);
    if (buttons.length !== PLATFORM_SCRUB_COUNT) return;

    let track = section.closest("[data-cn-platform-scrub='track']");
    // React may remount / move the section — re-wrap if our track lost it.
    if (track && !track.contains(section)) {
      track.remove();
      track = null;
    }

    if (!track) {
      track = document.createElement("div");
      track.setAttribute("data-cn-platform-scrub", "track");
      const sticky = document.createElement("div");
      sticky.setAttribute("data-cn-platform-scrub", "sticky");
      const parent = section.parentNode;
      if (!parent) return;
      parent.insertBefore(track, section);
      sticky.appendChild(section);
      track.appendChild(sticky);
    }

    const sticky = track.querySelector("[data-cn-platform-scrub='sticky']");
    const vh = getStableScrubVh();
    const nextTrackH = `${Math.round(PLATFORM_SCRUB_COUNT * PLATFORM_SCRUB_VH_PER * vh)}px`;
    const nextStickyH = `${Math.round(vh)}px`;
    // Only write when changed — rewriting height on every resize/URL-bar
    // wobble is what made direction-change scroll feel like a glitch.
    if (track.style.height !== nextTrackH) track.style.height = nextTrackH;
    if (sticky) {
      if (sticky.style.minHeight !== nextStickyH) sticky.style.minHeight = nextStickyH;
      // Prefer min-height only — a hard height + overflow clips the
      // wrapped platform tabs / chat mockup on short phones.
      if (sticky.style.height) sticky.style.removeProperty("height");
    }

    if (!platformScrubWired) {
      platformScrubWired = true;
      // Manual tab taps stay authoritative — remember the chosen index so
      // scroll hysteresis doesn't immediately fight the user's click.
      document.addEventListener(
        "click",
        (event) => {
          const sectionNow = findChannelDemoSection();
          if (!sectionNow) return;
          const buttonsNow = findPlatformButtons(sectionNow);
          const btn = event.target && event.target.closest && event.target.closest("button");
          if (!btn || !buttonsNow.includes(btn)) return;
          const idx = buttonsNow.indexOf(btn);
          if (idx >= 0) platformScrubIndex = idx;
        },
        true,
      );
    }

    syncPlatformScrub();
  };

  const patchEnterprisePricing = () => {
    document.querySelectorAll("#pricing button, [id='pricing'] button, section button").forEach((btn) => {
      const label = btn.textContent?.trim() ?? "";
      if (label === "Talk to Sales") btn.textContent = "Start Enterprise";
    });
    document.querySelectorAll("#pricing *, [id='pricing'] *").forEach((el) => {
      if (el.children.length > 0) return;
      const t = el.textContent?.trim() ?? "";
      if (t === "Custom" || t === "custom") el.textContent = "$199/mo";
    });
  };

  const patchLanding = () => {
    removeHeaderSignup();
    renameHeaderTryCta();
    heroSignupInsteadOfHowItWorks();
    quietMobileHeroChrome();
    hideMarquee();
    freezeMobileScrollMotion();
    lockMobileHeroHeight();
    ensureMobileChatBubbles();
    lockGrowingDemoHeights();
    layoutNightShiftCard();
    shortenNightShiftCopy();
    ensurePlatformScrub();
    patchEmDashes();
    patchEnterprisePricing();
    connectLinks();
  };

  /**
   * Every feature-section chat mockup (Unified Inbox, Catalogue AI, Order
   * Capture, Human Handoff, channel tabs) grows/shrinks its own card height
   * as messages/rows animate in — with no scroll container of its own, that
   * reflows the whole page and the browser fights to keep the visual scroll
   * position, which reads as the page jumping up and down while a demo
   * plays. Rather than guess each card's exact max-content pixel height,
   * measure it live: the first time a card is seen taller than its current
   * lock, grow the lock to match; never shrink it back down. After each demo
   * has cycled through its states once, every card settles at its own
   * tallest state and never changes size again, so nothing below it moves.
   */
  const growingDemoLocks = new WeakMap();
  let demoLockTicking = false;

  const GROWING_DEMO_CARD_SELECTOR =
    '[class*="max-w-sm"], [class*="min-h-[240px]"], [class*="overflow-y-auto"][class*="scroll-smooth"]';

  const growingDemoRoots = () => {
    const roots = new Set();
    // Card-shaped demo widgets: Unified Inbox / Catalogue AI / Order Capture /
    // Human Handoff / Appointment Booking / channel-tabs phone all use this
    // "max-w-sm card" convention, whether or not they contain .chat-msg (the
    // Appointment Booking slot-picker has none, and was missed when this only
    // walked up from .chat-msg elements).
    document.querySelectorAll(GROWING_DEMO_CARD_SELECTOR).forEach((el) => roots.add(el));
    // Fallback for any chat mockup nested one level deeper than a card match.
    document.querySelectorAll(".chat-msg").forEach((msg) => {
      const root = msg.closest(GROWING_DEMO_CARD_SELECTOR);
      if (root) roots.add(root);
    });
    return roots;
  };

  const lockGrowingDemoHeights = () => {
    growingDemoRoots().forEach((el) => {
      const locked = growingDemoLocks.get(el) || 0;

      // Measure natural content height with constraints briefly lifted.
      const prevOverflow = el.style.getPropertyValue("overflow");
      const prevMaxHeight = el.style.getPropertyValue("max-height");
      el.style.setProperty("overflow", "visible", "important");
      el.style.removeProperty("max-height");
      const natural = el.scrollHeight;
      if (prevOverflow) el.style.setProperty("overflow", prevOverflow, "important");
      else el.style.removeProperty("overflow");
      if (prevMaxHeight) el.style.setProperty("max-height", prevMaxHeight, "important");

      const next = Math.max(locked, natural);
      if (next <= 0) return;
      growingDemoLocks.set(el, next);
      const px = `${next}px`;
      el.style.setProperty("min-height", px, "important");
      el.style.setProperty("max-height", px, "important");
      el.style.setProperty("overflow", "hidden", "important");
      el.style.setProperty("scroll-behavior", "auto", "important");
    });
  };

  const scheduleDemoHeightLock = () => {
    if (demoLockTicking) return;
    demoLockTicking = true;
    requestAnimationFrame(() => {
      demoLockTicking = false;
      lockGrowingDemoHeights();
    });
  };

  // Only watch class/hidden (message swaps, typing toggles) — never "style",
  // since lockGrowingDemoHeights writes inline styles and would otherwise
  // retrigger itself forever.
  new MutationObserver(scheduleDemoHeightLock).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "hidden"],
  });

  /** Bottom category ticker — remove entirely at every viewport so it doesn't reserve dead space. */
  const hideMarquee = () => {
    document.querySelectorAll(".marquee, .cn-mobile-hero > .marquee, .cn-mobile-hero .marquee").forEach((el) => el.remove());
    document.querySelectorAll(".cn-mobile-hero > .absolute.inset-x-0.bottom-0").forEach((el) => {
      el.style.setProperty("display", "none", "important");
    });
  };

  /**
   * Bundle scroll handlers move parallax blobs + scale the progress bar — on
   * mobile that reads as page jitter / hero zoom. Neutralise every frame.
   */
  const freezeMobileScrollMotion = () => {
    if (!window.matchMedia("(max-width: 1023px)").matches) return;
    document.querySelectorAll("[data-parallax]").forEach((el) => {
      el.dataset.parallax = "0";
      el.style.setProperty("transform", "none", "important");
    });
    document.querySelector(".cn-mobile-hero .hero-photo")?.style.setProperty("transform", "none", "important");
    document.querySelector(".cn-mobile-hero .hero-mesh")?.style.setProperty("transform", "none", "important");
    document.querySelector(".scroll-progress")?.style.setProperty("display", "none", "important");
  };

  /**
   * Lock hero to current innerHeight so 100svh URL-bar resize can't jump
   * layout. Mobile Chrome/Safari fire `resize` as their URL bar
   * collapses/expands purely from scroll position/direction (collapses
   * scrolling down, snaps back expanded the moment scroll reverses
   * upward) — that's a viewport-height wobble, not a real layout change.
   * Only remeasure on the first run or a genuine width change (rotation /
   * desktop breakpoint); a width-only-unchanged resize is treated as URL-bar
   * noise and the existing lock is kept, otherwise the hero visibly
   * snaps taller/shorter at the exact moment scroll direction reverses.
   */
  let lockedHeroPx = 0;
  let lockedHeroWidth = 0;
  const lockMobileHeroHeight = () => {
    const hero = document.querySelector(".cn-mobile-hero");
    if (!hero) return;
    const mobile = window.matchMedia("(max-width: 1023px)").matches;
    if (!mobile) {
      hero.style.removeProperty("height");
      hero.style.removeProperty("min-height");
      hero.style.removeProperty("max-height");
      lockedHeroPx = 0;
      lockedHeroWidth = 0;
      return;
    }
    if (!lockedHeroPx || window.innerWidth !== lockedHeroWidth) {
      lockedHeroPx = window.innerHeight;
      lockedHeroWidth = window.innerWidth;
    }
    const h = `${lockedHeroPx}px`;
    hero.style.setProperty("height", h, "important");
    hero.style.setProperty("min-height", h, "important");
    hero.style.setProperty("max-height", h, "important");
  };

  patchLanding();
  const root = document.getElementById("root");
  if (root && root.childElementCount === 0) {
    const observer = new MutationObserver(() => {
      if (root.childElementCount > 0) {
        patchLanding();
        observer.disconnect();
      }
    });
    observer.observe(root, { childList: true });
  }
  let injectTicking = false;
  let heroLayoutReady = false;
  new MutationObserver(() => {
    if (injectTicking || heroLayoutReady) return;
    injectTicking = true;
    requestAnimationFrame(() => {
      injectTicking = false;
      patchLanding();
    });
  }).observe(document.body, { childList: true, subtree: true });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;

    const label = button.textContent?.trim() ?? "";
    if (/^Start (Free|Starter|Growth|Pro|Enterprise)$/.test(label)) {
      const link = document.createElement("a");
      link.href = "/try";
      link.click();
      return;
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
    // The mobile drawer's opaque bg-white/95 state must always win.
    const menuOpen = !!(state && state.always);

    header.style.removeProperty("box-shadow");

    const scrolled = Math.min(1, Math.max(0, window.scrollY / NAV_FADE_DISTANCE));
    const strength = menuOpen ? 1 : scrolled;

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

  /*
    A single rAF-batched scroll handler. Previously this ran
    freezeMobileScrollMotion() synchronously on every native `scroll` event
    (unthrottled — touch/momentum scrolling can fire many of those per
    frame) *and* queued a second, independent, un-deduped
    requestAnimationFrame call for the same function, on top of
    scheduleHeaderPaint()'s own separate rAF scheduler. That's up to 3
    querySelectorAll+style-write passes competing with the bundle's own
    per-frame scroll handlers (header hit-test, parallax transform,
    progress bar) for the same frame budget — the likely source of the
    general scroll jank. One ticking flag now guarantees both jobs run
    at most once per animation frame, together.
  */
  let mobileScrollTicking = false;
  window.addEventListener("scroll", () => {
    if (mobileScrollTicking) return;
    mobileScrollTicking = true;
    requestAnimationFrame(() => {
      mobileScrollTicking = false;
      paintHeader();
      freezeMobileScrollMotion();
      syncPlatformScrub();
    });
  }, { passive: true });
  window.addEventListener("resize", () => {
    scheduleHeaderPaint();
    // lockMobileHeroHeight() / getStableScrubVh() decide whether this resize
    // is a real width change or just URL-bar height wobble — don't force a
    // remeasure here, or every URL-bar collapse/expand snaps heights again.
    if (window.matchMedia("(max-width: 1023px)").matches) {
      lockMobileHeroHeight();
    }
    // Width-only changes (or first scrub mount) update the track; height-only
    // URL-bar noise is ignored inside ensurePlatformScrub via lockedScrubVh.
    ensurePlatformScrub();
  }, { passive: true });

  /*
    First-view hero — mobile ManyChat fold; desktop transparent bubble demo
    (dashboard panel backed up in _hero-backup/). Desktop bg: hero-laptop-v4.png.
    Mobile bg: mobilehero.jpg (ClerkNest desk lifestyle).
  */
  const HERO_LAYOUT_ID = "cn-mobile-hero-layout-v54";

  const ensureHeroLayoutStyle = () => {
    ["cn-mobile-hero-layout", "cn-mobile-hero-layout-v2", "cn-mobile-hero-layout-v3", "cn-mobile-hero-layout-v4", "cn-mobile-hero-layout-v5", "cn-mobile-hero-layout-v6", "cn-mobile-hero-layout-v7", "cn-mobile-hero-layout-v8", "cn-mobile-hero-layout-v9", "cn-mobile-hero-layout-v10", "cn-mobile-hero-layout-v11", "cn-mobile-hero-layout-v12", "cn-mobile-hero-layout-v13", "cn-mobile-hero-layout-v14", "cn-mobile-hero-layout-v15", "cn-mobile-hero-layout-v16", "cn-mobile-hero-layout-v17", "cn-mobile-hero-layout-v18", "cn-mobile-hero-layout-v19", "cn-mobile-hero-layout-v20", "cn-mobile-hero-layout-v21", "cn-mobile-hero-layout-v22", "cn-mobile-hero-layout-v23", "cn-mobile-hero-layout-v24", "cn-mobile-hero-layout-v25", "cn-mobile-hero-layout-v26", "cn-mobile-hero-layout-v27", "cn-mobile-hero-layout-v28", "cn-mobile-hero-layout-v29", "cn-mobile-hero-layout-v30", "cn-mobile-hero-layout-v31", "cn-mobile-hero-layout-v32", "cn-mobile-hero-layout-v33", "cn-mobile-hero-layout-v34", "cn-mobile-hero-layout-v35", "cn-mobile-hero-layout-v36", "cn-mobile-hero-layout-v37", "cn-mobile-hero-layout-v38", "cn-mobile-hero-layout-v39", "cn-mobile-hero-layout-v40", "cn-mobile-hero-layout-v41", "cn-mobile-hero-layout-v42", "cn-mobile-hero-layout-v43", "cn-mobile-hero-layout-v44", "cn-mobile-hero-layout-v45", "cn-mobile-hero-layout-v46", "cn-mobile-hero-layout-v47", "cn-mobile-hero-layout-v48", "cn-mobile-hero-layout-v49", "cn-mobile-hero-layout-v50", "cn-mobile-hero-layout-v51", "cn-mobile-hero-layout-v52", "cn-mobile-hero-layout-v53"].forEach(
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
      /* Bottom category ticker + fade band — hidden globally, not just mobile. */
      .marquee,
      .cn-mobile-hero > .marquee,
      .cn-mobile-hero .marquee {
        display: none !important;
      }
      .cn-mobile-hero > .absolute.inset-x-0.bottom-0 {
        display: none !important;
      }
      /* First-view hero subtext — near-white on dark hero at every viewport. */
      .cn-mobile-hero .cn-hero-copy > p {
        color: rgba(250, 248, 243, 0.92) !important;
        -webkit-text-fill-color: rgba(250, 248, 243, 0.92) !important;
      }
      /* Keep amber/gold star gradient — the p fill override above was
         washing ★★★★★ to white (text-grad-amber needs transparent fill). */
      .cn-mobile-hero .cn-hero-copy .text-grad-amber,
      .cn-mobile-hero .cn-hero-copy [class*="text-grad-amber"] {
        color: transparent !important;
        -webkit-text-fill-color: transparent !important;
        background-image: linear-gradient(90deg, #e6a33c, #f0b84a) !important;
        -webkit-background-clip: text !important;
        background-clip: text !important;
      }
      /* Shared bubble chrome — mobile + desktop first-view demos */
      .cn-channel-pill {
        align-self: flex-start;
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.3rem 0.7rem 0.3rem 0.4rem;
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
      .cn-channel-pill::before { display: none !important; content: none !important; }
      .cn-channel-logo {
        width: 1rem;
        height: 1rem;
        flex-shrink: 0;
        display: block;
      }
      .cn-channel-pill span {
        line-height: 1;
      }
      .cn-bubble-stage {
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        align-items: stretch;
        gap: 0.45rem;
        width: 100%;
        min-height: 5.5rem;
        overflow: hidden;
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
      .cn-bubble-typing-user {
        align-self: flex-start;
        background: rgba(250, 248, 243, 0.16);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 1.15rem 1.15rem 1.15rem 0.35rem;
        box-shadow: 0 8px 22px rgba(0, 0, 0, 0.18);
        backdrop-filter: blur(10px);
      }
      .cn-bubble-typing-user span {
        background: rgba(250, 248, 243, 0.7);
      }
      .cn-bubble-typing-ai {
        align-self: flex-end;
        background: #d91b5b;
        border-radius: 1.15rem 1.15rem 0.35rem 1.15rem;
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
      .cn-bubble-chip[hidden],
      .cn-bubble-typing[hidden] {
        display: none !important;
      }
      .cn-msg-row {
        display: flex;
        align-items: flex-end;
        gap: 0.45rem;
        width: 100%;
      }
      .cn-msg-row-user,
      .cn-msg-row-typing-user {
        justify-content: flex-start;
      }
      .cn-msg-row-ai,
      .cn-msg-row-typing,
      .cn-msg-row-typing-ai {
        justify-content: flex-end;
      }
      .cn-msg-row-chip {
        justify-content: center;
      }
      .cn-msg-body {
        max-width: calc(100% - 2.4rem);
        min-width: 0;
      }
      .cn-msg-row .cn-bubble {
        max-width: 100%;
      }
      .cn-avatar {
        flex-shrink: 0;
        width: 2.15rem;
        height: 2.15rem;
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        border: 1.5px solid rgba(255, 255, 255, 0.2);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.28);
        background: transparent;
      }
      .cn-avatar-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: center 18%;
        display: block;
      }
      .cn-avatar-user {
        background: transparent;
      }
      .cn-avatar-ai {
        background: transparent !important;
        border-color: rgba(255, 255, 255, 0.18);
        padding: 0;
      }
      .cn-avatar-ai .cn-avatar-img {
        object-fit: contain;
        object-position: center;
        padding: 0.12rem;
        box-sizing: border-box;
        background: transparent;
      }
      .cn-action-chip {
        background: rgba(250, 248, 243, 0.16) !important;
        border: 1px solid rgba(255, 255, 255, 0.22) !important;
        box-shadow: 0 8px 22px rgba(0, 0, 0, 0.2);
        font-weight: 700 !important;
      }
      .cn-bubble-pop {
        animation: cn-bubble-in 0.48s cubic-bezier(0.22, 1, 0.36, 1) both;
      }
      @keyframes cn-bubble-in {
        from { opacity: 0; transform: translateY(12px) scale(0.94); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes cn-typing-dot {
        0%, 80%, 100% { opacity: 0.35; transform: translateY(0); }
        40% { opacity: 1; transform: translateY(-2px); }
      }
      @media (prefers-reduced-motion: reduce) {
        .cn-bubble-pop { animation: none !important; }
        .cn-bubble-typing span { animation: none !important; opacity: 0.85; }
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
          padding-top: clamp(4.875rem, 12vw + 1.25rem, 5.75rem) !important;
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
          max-width: min(calc(100vw - 2rem), 24rem) !important;
          transform: none !important;
          opacity: 1 !important;
        }
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
          font-size: clamp(1.5625rem, 4vw + 0.9rem, 1.875rem) !important;
          line-height: 1.12 !important;
          margin-bottom: 0.55rem !important;
          letter-spacing: -0.02em !important;
        }
        .cn-mobile-hero .cn-hero-copy [data-cn-hero-sub] {
          font-size: clamp(0.6875rem, 2.1vw + 0.42rem, 0.8125rem) !important;
          line-height: 1.35 !important;
          margin-bottom: 0.9rem !important;
          max-width: 100% !important;
          letter-spacing: -0.015em !important;
          color: rgba(250, 248, 243, 0.92) !important;
          -webkit-text-fill-color: rgba(250, 248, 243, 0.92) !important;
        }
        .cn-mobile-hero .cn-hero-copy [data-cn-hero-sub] .cn-hero-sub-l1,
        .cn-mobile-hero .cn-hero-copy [data-cn-hero-sub] .cn-hero-sub-l2 {
          display: block;
        }
        .cn-mobile-hero .cn-hero-copy [data-cn-hero-sub] .cn-hero-sub-l2 {
          margin-top: 0.05em;
        }
        .cn-mobile-hero .cn-hero-visual {
          display: none !important;
        }
        .cn-mobile-hero .hero-mesh {
          display: none !important;
        }
        .cn-mobile-hero .hero-photo {
          background-image: url("/clerknest-assets/mobilehero.jpg") !important;
          background-size: cover !important;
          /* Dark wall on the left reads behind headline; desk scene fills lower fold. */
          background-position: 36% 24% !important;
          background-repeat: no-repeat !important;
          filter: brightness(0.82) saturate(0.94) contrast(1.02) !important;
        }
        .cn-mobile-hero .hero-photo + div {
          background: linear-gradient(
            105deg,
            rgba(13, 11, 9, 0.68) 0%,
            rgba(13, 11, 9, 0.52) 34%,
            rgba(13, 11, 9, 0.22) 58%,
            rgba(13, 11, 9, 0.36) 100%
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
        .cn-mobile-bubbles .cn-bubble-stage {
          min-height: 8.75rem;
          max-height: none;
          overflow: visible;
        }
        @media (max-width: 399px) {
          .cn-mobile-hero .cn-hero-copy {
            max-width: min(20.5rem, calc(100vw - 2rem)) !important;
          }
          .cn-mobile-hero .cn-hero-copy [data-cn-hero-sub] {
            font-size: clamp(0.625rem, 2.4vw + 0.38rem, 0.6875rem) !important;
            letter-spacing: -0.02em !important;
          }
          .cn-mobile-hero .cn-hero-copy h1,
          .cn-mobile-hero .cn-hero-copy [class*="text-[30px]"] {
            font-size: clamp(1.5rem, 5vw + 0.5rem, 1.6875rem) !important;
          }
        }
        @media (min-width: 400px) and (max-width: 639px) {
          .cn-mobile-hero .cn-hero-copy {
            max-width: calc(100vw - 2rem) !important;
          }
        }
        @media (min-width: 640px) and (max-width: 1023px) {
          .cn-mobile-hero {
            flex-direction: column !important;
            align-items: stretch !important;
            justify-content: flex-start !important;
          }
          .cn-mobile-hero > .max-w-7xl {
            flex: 0 0 auto !important;
            width: 100% !important;
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: 0 !important;
            padding-top: clamp(4.75rem, 5vh + 3.25rem, 6.25rem) !important;
            padding-bottom: 0 !important;
            min-height: 0 !important;
          }
          .cn-mobile-hero .cn-hero-copy {
            flex: 0 0 auto !important;
            max-width: min(32rem, 72vw) !important;
            padding-bottom: 0 !important;
          }
          .cn-mobile-hero .cn-hero-copy h1,
          .cn-mobile-hero .cn-hero-copy [class*="text-[30px]"] {
            font-size: clamp(1.875rem, 3vw + 0.75rem, 2.125rem) !important;
          }
          .cn-mobile-hero .cn-hero-copy [data-cn-hero-sub] {
            font-size: 0.8125rem !important;
          }
          .cn-mobile-bubbles {
            flex: 0 0 auto !important;
            width: 100% !important;
            max-width: min(28rem, 88vw) !important;
            margin-top: auto !important;
            margin-left: auto !important;
            margin-right: auto !important;
            align-self: center !important;
            padding: 0.35rem 1rem 1.35rem !important;
          }
          .cn-mobile-hero .hero-photo {
            background-position: 50% 18% !important;
          }
        }
        @media (max-width: 1023px) and (max-height: 520px) {
          .cn-mobile-hero {
            flex-direction: row !important;
            align-items: flex-start !important;
            overflow: hidden !important;
          }
          .cn-mobile-hero > .max-w-7xl {
            flex: 0 1 44% !important;
            flex-direction: column !important;
            align-items: flex-start !important;
            min-height: 0 !important;
            height: auto !important;
            padding-top: 3rem !important;
            gap: 0 !important;
            overflow: hidden !important;
          }
          .cn-mobile-hero .cn-hero-copy {
            flex: 1 1 auto !important;
            max-width: 100% !important;
            min-width: 0 !important;
            padding-bottom: 0 !important;
          }
          .cn-mobile-hero .cn-hero-copy [data-cn-hero-badge] {
            margin-bottom: 0.25rem !important;
            font-size: 0.5625rem !important;
            padding: 0.2rem 0.55rem !important;
          }
          .cn-mobile-hero .cn-hero-copy h1,
          .cn-mobile-hero .cn-hero-copy [class*="text-[30px]"] {
            font-size: 1.25rem !important;
            line-height: 1.1 !important;
            margin-bottom: 0.3rem !important;
          }
          .cn-mobile-hero .cn-hero-copy [data-cn-hero-sub] {
            font-size: 0.625rem !important;
            line-height: 1.3 !important;
            margin-bottom: 0.4rem !important;
          }
          .cn-mobile-hero .cn-hero-copy > div:has(.bg-grad-rose),
          .cn-mobile-hero .cn-hero-copy > div:has(a) {
            gap: 0.4rem !important;
          }
          .cn-mobile-hero .cn-hero-copy .bg-grad-rose,
          .cn-mobile-hero .cn-hero-copy a:not(.bg-grad-rose),
          .cn-mobile-hero .cn-hero-copy button:not(.bg-grad-rose) {
            min-height: 2.15rem !important;
            padding: 0.45rem 0.75rem !important;
            font-size: 0.6875rem !important;
          }
          .cn-mobile-hero .cn-hero-copy [data-cn-hero-platforms] {
            display: none !important;
          }
          .cn-mobile-bubbles {
            flex: 1 1 56% !important;
            margin-top: 0 !important;
            align-self: stretch !important;
            justify-content: flex-end !important;
            padding: 0.25rem 0.65rem 0.5rem !important;
            max-height: calc(100vh - 3rem) !important;
            overflow: hidden !important;
          }
          .cn-mobile-bubbles .cn-bubble-stage {
            min-height: 0 !important;
            max-height: 100% !important;
            gap: 0.3rem !important;
          }
          .cn-mobile-bubbles .cn-avatar {
            width: 1.65rem !important;
            height: 1.65rem !important;
          }
          .cn-mobile-bubbles .cn-bubble-user,
          .cn-mobile-bubbles .cn-bubble-ai p {
            font-size: 0.6875rem !important;
          }
          .cn-mobile-bubbles .cn-bubble-user,
          .cn-mobile-bubbles .cn-bubble-ai {
            padding: 0.45rem 0.6rem !important;
          }
          .cn-mobile-bubbles .cn-channel-pill {
            font-size: 0.5625rem !important;
            padding: 0.2rem 0.5rem 0.2rem 0.35rem !important;
          }
        }
        [class*="h-[318px]"],
        [class*="h-\\[318px\\]"] {
          min-height: 400px !important;
          max-height: 400px !important;
          overflow: hidden !important;
        }
        .overflow-y-auto.scroll-smooth {
          overflow: hidden !important;
        }
        /*
          Channel-switcher tabs — phone-only compact row. Tablets keep
          bundle sizing; only labels shorten on narrow phones (JS).
        */
        @media (max-width: 639px) {
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
        @media (min-width: 640px) and (max-width: 1023px) {
          [class*="overflow-x-auto"][class*="mb-8"] {
            overflow: visible !important;
            justify-content: center !important;
          }
          [class*="overflow-x-auto"][class*="mb-8"] > [class*="inline-flex"][class*="rounded-full"] {
            gap: 0.25rem !important;
            padding: 0.3rem !important;
          }
          [class*="overflow-x-auto"][class*="mb-8"] button[class*="whitespace-nowrap"] {
            padding: 0.45rem 0.75rem !important;
            font-size: 0.8125rem !important;
            line-height: 1.25 !important;
            gap: 0.35rem !important;
          }
          [class*="overflow-x-auto"][class*="mb-8"] button[class*="whitespace-nowrap"] svg {
            width: 0.875rem !important;
            height: 0.875rem !important;
          }
        }
        /* Tablet header — desktop nav visible but tight; breathe the row. */
        @media (min-width: 768px) and (max-width: 1023px) {
          header.fixed > .max-w-7xl,
          header.fixed .max-w-7xl {
            justify-content: space-between !important;
            gap: 0.75rem !important;
          }
          header.fixed nav[class*="md:flex"] {
            gap: 1.35rem !important;
            flex-shrink: 1 !important;
            min-width: 0 !important;
          }
          header.fixed nav[class*="md:flex"] a {
            font-size: 0.8125rem !important;
            white-space: nowrap !important;
          }
          header.fixed .flex.items-center.gap-4 {
            gap: 0.65rem !important;
            flex-shrink: 0 !important;
          }
          header.fixed .flex.items-center.gap-4 a,
          header.fixed .flex.items-center.gap-4 button {
            font-size: 0.8125rem !important;
            white-space: nowrap !important;
          }
        }
      }
      @media (min-width: 1024px) {
        .cn-mobile-bubbles { display: none !important; }
        /*
          Desktop/laptop bg: hero-laptop-v4.png. Dashboard panel hidden —
          transparent bubble demo (same scripts + chips as mobile).
        */
        .cn-mobile-hero {
          min-height: 100vh !important;
          position: relative !important;
        }
        .cn-mobile-hero .hero-mesh {
          display: none !important;
        }
        .cn-mobile-hero .hero-photo {
          background-image: url("/clerknest-assets/hero-laptop-v4.png") !important;
          background-size: cover !important;
          background-position: center center !important;
          background-repeat: no-repeat !important;
          position: absolute !important;
          inset: 0 !important;
          width: 100% !important;
          height: 100% !important;
          filter: brightness(0.78) saturate(0.95) contrast(1.02) !important;
        }
        .cn-mobile-hero .hero-photo + div {
          position: absolute !important;
          inset: 0 !important;
          background: linear-gradient(
            100deg,
            rgba(13, 11, 9, 0.72) 0%,
            rgba(13, 11, 9, 0.38) 40%,
            rgba(13, 11, 9, 0.06) 66%,
            rgba(13, 11, 9, 0.12) 100%
          ) !important;
        }
        /* Restore gold stars — white hero copy overrides wash them out */
        .cn-mobile-hero .cn-hero-copy [class*="text-gold"],
        .cn-mobile-hero .cn-hero-copy [class*="text-amber"],
        .cn-mobile-hero .cn-hero-copy [class*="text-glow"],
        .cn-mobile-hero .cn-hero-copy [aria-label*="star"],
        .cn-mobile-hero .cn-hero-copy [aria-label*="5"] {
          color: #e6a33c !important;
          -webkit-text-fill-color: #e6a33c !important;
        }
        .cn-mobile-hero .cn-hero-visual {
          position: relative !important;
          z-index: 2 !important;
          display: flex !important;
          align-items: center !important;
          justify-content: flex-end !important;
          min-height: 26rem !important;
          align-self: center !important;
        }
        .cn-mobile-hero .cn-hero-visual > [data-cn-dashboard-hidden] {
          display: none !important;
        }
        .cn-desktop-bubbles {
          position: absolute !important;
          right: clamp(1.25rem, 6vw, 5.5rem);
          bottom: clamp(1.25rem, 4vh, 3rem);
          top: auto;
          transform: none;
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 0.55rem;
          width: min(26rem, 34vw);
          height: 22.5rem;
          padding: 0.35rem 0.2rem;
          pointer-events: none;
          z-index: 6;
          box-sizing: border-box;
        }
        .cn-mobile-hero > .max-w-7xl {
          padding-top: clamp(5rem, 8vh, 6.5rem) !important;
          justify-content: flex-start !important;
          align-items: flex-start !important;
        }
        .cn-mobile-hero .cn-hero-copy {
          margin-top: 0 !important;
        }
        /*
          Real laptop/desktop only (fine pointer + hover) — iPad Pro also
          matches min-width:1024px above and its "text a bit up" placement
          (align-items: flex-start, above) is intentional for that device;
          this narrower query can't touch it since a touch-only iPad reports
          hover:none/pointer:coarse. On an actual laptop the hero column was
          pinned ~80px from the top of a full-height section with nothing
          filling the rest, reading as "stuck at the top" — vertically
          centering it in the section (padding-top removed, since centering
          already accounts for the header, which overlays rather than
          occupying layout height) fixes that without touching iPad Pro.
        */
        @media (hover: hover) and (pointer: fine) {
          .cn-mobile-hero > .max-w-7xl {
            padding-top: 0 !important;
            align-items: center !important;
          }
        }
        .cn-desktop-bubbles .cn-bubble-stage,
        .cn-desktop-bubbles .cn-desktop-stage {
          flex: 1 1 auto;
          height: 100%;
          min-height: 0;
          max-height: 100%;
          gap: 0.65rem;
          justify-content: flex-start !important;
          align-content: flex-start;
          overflow: hidden;
        }
        .cn-desktop-bubbles .cn-bubble-user,
        .cn-desktop-bubbles .cn-bubble-ai p {
          font-size: 0.92rem;
          line-height: 1.4;
        }
        .cn-desktop-bubbles .cn-bubble-user,
        .cn-desktop-bubbles .cn-bubble-ai,
        .cn-desktop-bubbles .cn-bubble-typing {
          padding: 0.85rem 1.05rem;
        }
        .cn-desktop-bubbles .cn-bubble-chip,
        .cn-desktop-bubbles .cn-action-chip {
          font-size: 0.8rem;
          padding: 0.42rem 0.95rem;
        }
        .cn-desktop-bubbles .cn-channel-pill {
          font-size: 0.8rem;
          padding: 0.38rem 0.85rem;
        }
        .cn-desktop-bubbles .cn-avatar {
          width: 2.05rem;
          height: 2.05rem;
        }
      }
      @media (max-width: 1023px) {
        .cn-desktop-bubbles { display: none !important; }
      }
    `;
    document.head.appendChild(style);
  };

  /**
   * "Multi-channel intelligence" feature section (brain card + WhatsApp /
   * Instagram / Messenger / Website Chat cards): on mobile the 2x2 grid
   * ships with mismatched card heights (notes wrap to 1–2 lines unevenly,
   * so the stat pills land at different heights), a "Website Chat" label
   * clipped to "Website …" by the bundle's own truncate class, and flat,
   * shadowless cards with barely any gap — reads as cramped/jumbled next
   * to the rest of the mobile redesign. Purely additive CSS, scoped to
   * this section's own class combinations so desktop and every other
   * section are untouched: even card heights via flex column, the label
   * fix, and a touch of premium depth (shadow/border/sheen) to match the
   * dark hero's polish.
   */
  const MULTI_CHANNEL_MOBILE_ID = "cn-mobile-multichannel-v1";

  const ensureMultiChannelMobileStyle = () => {
    if (document.getElementById(MULTI_CHANNEL_MOBILE_ID)) return;
    const style = document.createElement("style");
    style.id = MULTI_CHANNEL_MOBILE_ID;
    style.textContent = `
      @media (max-width: 1023px) {
        /* Brain card + 4-card grid wrapper — more breathing room between them */
        [class*="max-w-4xl"][class*="lg:h-[500px]"] {
          gap: 1.75rem !important;
        }
        /* "One AI brain" card */
        [class*="w-40"][class*="h-40"][class*="bg-obsidian"] {
          border-radius: 1.75rem !important;
          box-shadow:
            0 20px 40px -14px rgba(13, 11, 9, 0.5),
            inset 0 1px 0 rgba(255, 255, 255, 0.08) !important;
        }
        /* Faint stem visually linking the brain to the channels below it */
        [class*="lg:-translate-x-1/2"][class*="lg:-translate-y-1/2"][class*="z-10"] {
          position: relative !important;
        }
        [class*="lg:-translate-x-1/2"][class*="lg:-translate-y-1/2"][class*="z-10"]::after {
          content: "";
          position: absolute;
          left: 50%;
          bottom: -1.75rem;
          transform: translateX(-50%);
          width: 2px;
          height: 1.5rem;
          background: linear-gradient(to bottom, rgba(13, 11, 9, 0.22), rgba(13, 11, 9, 0));
          pointer-events: none;
        }
        /* Channel card grid — more air between cards */
        [class*="grid-cols-2"][class*="lg:hidden"] {
          gap: 0.875rem !important;
        }
        [class*="grid-cols-2"][class*="lg:hidden"] > [class*="lift"][class*="rounded-2xl"] {
          display: flex !important;
          flex-direction: column !important;
          min-height: 9.75rem !important;
          padding: 1.125rem !important;
          border-radius: 1.25rem !important;
          border: 1px solid rgba(255, 255, 255, 0.16) !important;
          box-shadow:
            0 14px 26px -12px rgba(13, 11, 9, 0.4),
            inset 0 1px 0 rgba(255, 255, 255, 0.18) !important;
          position: relative !important;
          overflow: hidden !important;
        }
        /* Soft diagonal sheen for depth, kept behind the card's own content */
        [class*="grid-cols-2"][class*="lg:hidden"] > [class*="lift"][class*="rounded-2xl"]::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(155deg, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0) 55%);
          pointer-events: none;
        }
        [class*="grid-cols-2"][class*="lg:hidden"] > [class*="lift"][class*="rounded-2xl"] > * {
          position: relative;
          z-index: 1;
        }
        /* Note paragraph (2nd child) grows to fill the card, so every stat
           pill lands on the same baseline regardless of note line count. */
        [class*="grid-cols-2"][class*="lg:hidden"] > [class*="lift"][class*="rounded-2xl"] > *:nth-child(2) {
          flex: 1 1 auto !important;
          margin-bottom: 0.75rem !important;
          font-size: 0.75rem !important;
          line-height: 1.4 !important;
        }
        /* Stat pill (3rd child) — stop it stretching full-width now the
           card is a flex column (flex default is align-items: stretch).
           Longest label ("19 orders captured today") needs to stay at the
           bundle's own 10px size + wrap fallback, or it clips past the
           card edge at this width. */
        [class*="grid-cols-2"][class*="lg:hidden"] > [class*="lift"][class*="rounded-2xl"] > *:nth-child(3) {
          align-self: flex-start !important;
          max-width: 100% !important;
          white-space: normal !important;
          font-size: 0.625rem !important;
          line-height: 1.3 !important;
          padding: 0.3rem 0.55rem !important;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18) !important;
        }
        /* Icon badge — slightly larger for clearer hierarchy at this size */
        [class*="grid-cols-2"][class*="lg:hidden"] > [class*="lift"][class*="rounded-2xl"] [class*="w-9"][class*="h-9"] {
          width: 2.5rem !important;
          height: 2.5rem !important;
          box-shadow:
            inset 0 1px 1px rgba(255, 255, 255, 0.35),
            0 2px 6px rgba(0, 0, 0, 0.15) !important;
        }
        /* Fix: "Website Chat" was clipped to "Website …" by the bundle's
           own truncate class at this card width — let it wrap instead. */
        [class*="grid-cols-2"][class*="lg:hidden"] > [class*="lift"][class*="rounded-2xl"] [class*="truncate"] {
          white-space: normal !important;
          overflow: visible !important;
          text-overflow: clip !important;
          font-size: 0.8125rem !important;
          line-height: 1.2 !important;
        }
      }
    `;
    document.head.appendChild(style);
  };

  /**
   * "The till is closed" section — a real mobile-specific layout rather than
   * just a spacing fix. This heading/body/eyebrow ship with zero mobile
   * overrides in the bundle (unlike the first-view hero, which gets its own
   * `.cn-mobile-hero` treatment): at 360-390px the h2 renders at its
   * desktop `text-5xl` (48px) size and the hard `<br>` between "The till is
   * closed." and "Your phone isn't." combines with that size to wrap into
   * 4 lines instead of the intended 2. Sized down here so each half of the
   * line-break fits on its own line. The body paragraph is long enough
   * (~200 characters, 3 clauses) that no reasonable mobile font size fits
   * it in 3 lines, so shortenNightShiftCopy() (JS, above) trims the copy
   * itself for mobile; this block only handles the smaller/tighter type
   * treatment. The "Built for salons…" caption is hidden on mobile: with
   * the badges directly below already naming concrete capabilities and the
   * headline/body already setting up the "who this is for" story, it was
   * a third pass at the same idea with its own margin — cutting it removes
   * both a redundant line and a chunk of vertical space in one move. Every
   * remaining gap (heading, body, badges, card) is intentionally tighter
   * than earlier iterations so the section reads efficient rather than
   * empty, while still keeping enough air that nothing collides.
   */
  const NIGHT_SHIFT_MOBILE_ID = "cn-mobile-nightshift-v4";

  const ensureNightShiftMobileStyle = () => {
    ["cn-mobile-nightshift-v1", "cn-mobile-nightshift-v2", "cn-mobile-nightshift-v3"].forEach((id) =>
      document.getElementById(id)?.remove(),
    );
    if (document.getElementById(NIGHT_SHIFT_MOBILE_ID)) return;
    const style = document.createElement("style");
    style.id = NIGHT_SHIFT_MOBILE_ID;
    style.textContent = `
      @media (max-width: 1023px) {
        /* Section wrapper — bundle ships py-24 (96px top+bottom) meant for
           a wide desktop canvas; that's dead space on a phone once the
           content column is this narrow. Top trimmed further than bottom
           (was 3rem/3rem) so the text block hugs the top edge instead of
           floating centered mid-section. */
        [class*="max-w-7xl"][class*="px-6"][class*="py-24"] {
          padding-top: 2rem !important;
          padding-bottom: 2.25rem !important;
        }
        /* The section normally centers its one content column vertically
           (bundle's own "flex items-center") — fine when the column is
           short, but that's exactly what kept the whole text+CTA block
           floating in the middle instead of spreading top-to-bottom.
           Stretching the column to the section's full height gives the
           top/bottom anchoring below something to actually push against. */
        ${NIGHT_SHIFT_SECTION_SELECTOR} {
          align-items: stretch !important;
        }
        ${NIGHT_SHIFT_SECTION_SELECTOR} > [class*="max-w-7xl"] {
          display: flex !important;
          flex-direction: column !important;
        }
        ${NIGHT_SHIFT_SECTION_SELECTOR} .max-w-xl {
          display: flex !important;
          flex-direction: column !important;
          flex: 1 1 auto !important;
        }
        /* CTA — pinned to the bottom of that column. margin-top:auto on a
           flex item eats all the free space above it in one gap, so the
           heading/body above stay tightly grouped at the top instead of
           that space splitting evenly between every paragraph (which is
           what plain "justify-content: space-between" on the column would
           do instead). Matched via its child link rather than a fragile
           nth-child/last-child, since the hidden, JS-relocated proof card
           (layoutNightShiftCard()) also lands as a later child of this
           same column. */
        ${NIGHT_SHIFT_SECTION_SELECTOR} .max-w-xl > div:has(> a[class*="bg-grad-rose"]) {
          margin-top: auto !important;
          padding-top: 2.5rem !important;
        }
        /* Eyebrow — tightened tracking so it has a shot at one line, and a
           much smaller gap down to the headline. */
        [class*="text-rose-bright"][class*="tracking-\\[\\.18em\\]"] {
          letter-spacing: 0.1em !important;
          margin-bottom: 0.5rem !important;
        }
        /* Headline — the bundle's own hard <br> already splits "The till is
           closed." from "Your phone isn't."; sized so each half fits its
           own line instead of each half wrapping again into two more. */
        h2[class*="clip-host"] {
          font-size: 1.65rem !important;
          line-height: 1.12 !important;
          margin-bottom: 0.65rem !important;
        }
        /* Body copy — shortened text (JS) at a compact, still-legible size.
           Column width capped (rather than left full-bleed) so the same
           sentence breaks into 3 balanced lines instead of 2 long ones. */
        [class*="text-ivory/70"][class*="max-w-md"] {
          font-size: 0.9375rem !important;
          line-height: 1.45 !important;
          margin-bottom: 1.85rem !important;
          max-width: 19.5rem !important;
        }
        /* "Built for salons…" caption — redundant with the badges that used
           to sit directly below it; dropped on mobile only, desktop keeps
           the full copy. */
        [class*="text-ivory/45"][class*="mb-9"] {
          display: none !important;
        }
        /* Badge pills + proof card — removed from mobile entirely per
           request: heading → body copy → CTA reads cleaner and airier on a
           narrow phone screen than fitting every desktop element in. Body
           copy's margin-bottom above (1.85rem) replaces the breathing room
           the badges used to provide before the CTA. Desktop is untouched;
           layoutNightShiftCard() still relocates the card in-flow on
           mobile (harmless — it's simply hidden wherever it lands). */
        [class*="flex-wrap"][class*="gap-2"][class*="mb-10"],
        [class*="max-w-[300px]"][class*="bg-obsidian/75"] {
          display: none !important;
        }
      }
    `;
    document.head.appendChild(style);
  };

  /**
   * "They hired the night shift." stats bar — the bundle ships this as a
   * literal 2-column table: four cells welded together with 1px hairlines
   * (`gap-px bg-linen`) inside a bordered, rounded box. That reads as a
   * generic "stats widget" template at any width, but especially cramped
   * as a 2x2 grid on a ~340px mobile column. Rebuilt on mobile only as an
   * unboxed stat list: no fill, no grid lines, no rounded card — each row
   * pairs a right-aligned rose figure with its label on a single thin
   * hairline, closer to an editorial spec sheet than a dashboard tile.
   * Desktop keeps the original boxed grid untouched (no override outside
   * the 1023px breakpoint).
   */
  const STATS_GRID_MOBILE_ID = "cn-mobile-statsgrid-v1";
  const STATS_GRID_SELECTOR = '[class*="grid-cols-2"][class*="bg-linen"][class*="border-linen"][class*="rounded-2xl"]';

  const ensureStatsGridMobileStyle = () => {
    if (document.getElementById(STATS_GRID_MOBILE_ID)) return;
    const style = document.createElement("style");
    style.id = STATS_GRID_MOBILE_ID;
    style.textContent = `
      @media (max-width: 1023px) {
        ${STATS_GRID_SELECTOR} {
          display: flex !important;
          flex-direction: column !important;
          background: transparent !important;
          border: none !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          overflow: visible !important;
          gap: 0 !important;
          margin-bottom: 2.5rem !important;
        }
        ${STATS_GRID_SELECTOR} > div {
          background: transparent !important;
          display: grid !important;
          grid-template-columns: 4.5rem 1fr !important;
          column-gap: 1.1rem !important;
          align-items: baseline !important;
          text-align: left !important;
          padding: 1.05rem 0.1rem !important;
          border-bottom: 1px solid var(--color-linen) !important;
          position: relative !important;
        }
        ${STATS_GRID_SELECTOR} > div:first-child {
          padding-top: 0 !important;
        }
        ${STATS_GRID_SELECTOR} > div:last-child {
          border-bottom: none !important;
          padding-bottom: 0 !important;
        }
        ${STATS_GRID_SELECTOR} > div > p:first-child {
          text-align: right !important;
          font-size: 1.6rem !important;
          line-height: 1 !important;
          margin-bottom: 0 !important;
          color: var(--color-rose) !important;
          white-space: nowrap !important;
        }
        ${STATS_GRID_SELECTOR} > div > p:last-child {
          text-align: left !important;
          max-width: none !important;
          margin: 0 !important;
          font-size: 0.8rem !important;
          line-height: 1.35 !important;
        }
      }
    `;
    document.head.appendChild(style);
  };

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
  ensureMultiChannelMobileStyle();
  ensureNightShiftMobileStyle();
  ensureStatsGridMobileStyle();
  applyHeroLayout();
  ensurePlatformScrub();
  let layoutResizeWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    // Mobile URL bar show/hide fires resize with height-only change on every
    // scroll-direction flip. Re-running applyHeroLayout there unsets
    // heroLayoutReady, rewrites locks, and fights the sticky scrub.
    const width = window.innerWidth;
    if (width === layoutResizeWidth) {
      lockMobileHeroHeight();
      if (window.matchMedia("(max-width: 1023px)").matches) fitHeroSubtext();
      ensurePlatformScrub();
      return;
    }
    layoutResizeWidth = width;
    heroLayoutReady = false;
    applyHeroLayout();
    layoutNightShiftCard();
    shortenNightShiftCopy();
    formatHeroSubtext();
    ensurePlatformScrub();
  }, { passive: true });
  window.addEventListener("orientationchange", () => {
    lockedHeroPx = 0;
    lockedHeroWidth = 0;
    setTimeout(() => {
      layoutResizeWidth = window.innerWidth - 1;
      heroLayoutReady = false;
      applyHeroLayout();
      layoutNightShiftCard();
      shortenNightShiftCopy();
      formatHeroSubtext();
      ensurePlatformScrub();
    }, 150);
  }, { passive: true });
  let layoutTicking = false;
  new MutationObserver(() => {
    if (layoutTicking) return;
    layoutTicking = true;
    requestAnimationFrame(() => {
      layoutTicking = false;
      const hero = document.querySelector("section[data-navtheme='dark']");
      const mobile = window.matchMedia("(max-width: 1023px)").matches;
      const heroStale =
        mobile && hero && (!hero.classList.contains("cn-mobile-hero") || !hero.querySelector("[data-cn-hero-sub]"));
      if (!heroLayoutReady || heroStale) {
        applyHeroLayout();
        ensurePlatformScrub();
      } else {
        // Dashboard React tree can mount after first layout — keep bubbles
        // and the hidden-panel state in sync without resetting the hero.
        ensureMobileChatBubbles();
        if (mobile) {
          quietMobileHeroChrome();
          formatHeroSubtext();
        }
      }
    });
  }).observe(document.body, { childList: true, subtree: true });
})();