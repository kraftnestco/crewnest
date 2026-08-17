# 27 — UI Revamp (implementation spec)

**Status:** ready to implement. **Audience:** Sonnet.
**Supersedes:** the standalone `clerknest-ui-revamp-guide.md`. Where the two disagree, this file wins —
it was written against the tree at `ca8a93a`, the earlier guide was written against screenshots.

Read `docs/README.md` → `01-ARCHITECTURE` → `02-SECURITY` → `19-PREMIUM-UI-AND-GROWTH` first.
This file assumes the locked decisions in `CLAUDE.md`, especially **#2, zero secrets on the client**.

---

## 0. Ground rules

### 0.1 The complexity doctrine (read this before every task)

ClerkNest sells to two owners at once: a shop owner who has never configured software, and a
technical operator who wants depth. Serving both does **not** mean a "simple / advanced" toggle —
that doubles the surface area and tells the non-technical owner they are in the wrong mode.

**One UI. Depth is always exactly one tap down, always in the same place.**

Apply this test to every change in this document:

> Does this reduce the number of things the owner must understand to finish their most common task?

- **Yes** → ship it, even if it adds visual richness.
- **No, it adds a concept they must learn before the screen makes sense** → it is complexity. Move it
  one level down, behind a tap on the thing it describes.

Concretely:
- **Surface** = plain language, one action per item. "Talha — waiting on payment" + one button.
- **Depth** = a detail sheet opened from that same row: the mechanism, the settings, the raw log,
  what the AI decided and why.
- Never put a mechanism word on the surface. `Webhook`, `workflow`, `token`, `sync`, `record`,
  `endpoint` are depth vocabulary. §7.3 has the substitution table.

### 0.2 What is already done — do not redo it

The earlier guide predates these. Verify before touching:

| Already shipped | Where |
|---|---|
| 44px hit-area expansion on coarse pointers | `src/app/globals.css:192-224` |
| Mobile tab bar as a flex sibling (not `fixed`), `h-dvh` shell | `src/components/app-nav.tsx:68-101`, `src/app/dashboard/layout.tsx` |
| Full dark theme + user toggle | `src/app/globals.css:94-126`, `src/components/theme-toggle.tsx` |
| `EmptyState`, `PageHeader`, `StatusLegend` primitives | `src/components/` |
| Entitlements as single source of truth feeding pricing copy | `src/lib/entitlements.ts`, `src/services/demo/plans.ts` |
| Four pricing tiers, config-driven highlight | `src/services/demo/plans.ts` |

The 44px work is **partial**, not complete — see D-03. The tab bar has a **confirmed bug** — see D-08.

### 0.3 Non-negotiables

- Never ship, return, or log an LLM key, Meta secret, service-role key, or decrypted token.
- `lib/supabase/service.ts` is `server-only`. Never import it into a client component.
- Tailwind v4, CSS-first. There is no `tailwind.config.js`. Tokens live in `globals.css`.
- shadcn here is built on `@base-ui/react`, **not Radix**. There is no `asChild`. Use
  `cn(buttonVariants({...}))` on a `<Link>`, or the `render={<Link/>}` prop.
- The design system is **OKLCH**. Do not introduce hex tokens. The earlier guide's hex values are
  correct colours but the wrong notation — converting them is part of the task, not optional.
- Run `npm run build`, not just `tsc --noEmit`. Server/client boundary errors only surface in a
  full build.

---

## 1. Verified defect register

Every row was confirmed by reading the file at `ca8a93a`. `file:line` is where the fix goes.

| ID | Defect | Evidence | Sev |
|---|---|---|---|
| D-01 | **No mobile navigation on the marketing page.** The anchor group is `hidden md:flex`; there is no hamburger, sheet, or overflow. On a phone, How it works / Pricing / FAQ are unreachable. | `src/app/page.tsx:111` | Critical |
| D-02 | **`#features` has no heading.** Heading order on the page is H1, H2, H2, H2, H2 — the features section renders four cards with no section title, and is absent from the nav. | `src/app/page.tsx:220-237` | High |
| D-03 | **The 44px rule does not cover the marketing page.** `nav a::after { content: none }` disables it for every anchor inside a `<nav>`, including the marketing header. `<summary>` and bare `<a>` are not in the selector list at all, so FAQ rows (~20px) and footer links (~20px) stay undersized. | `globals.css:201-223`, `page.tsx:110-129`, `page.tsx:311`, `page.tsx:349-378` | High |
| D-04 | **The whole page uses two grounds that differ by 1.2% lightness.** Sections alternate `--background` `oklch(0.988 …)` and `--card` `oklch(1 0 0)`. There is no colour contrast between stages — this is the entire "flat / no variation" problem, quantified. | `globals.css:60,62`; `page.tsx:176,239,321` | High |
| D-05 | **Hero demo is below the fold on mobile.** The grid stacks to one column and `<HeroVisual/>` is the second child, so it begins ~614px into a 664px viewport. The product's only proof is invisible until you scroll. | `page.tsx:148-171` | Critical |
| D-06 | Sub-12px type in the header lockup (`0.7rem` = 11.2px). | `page.tsx:107` | Low |
| D-07 | **The $0 and $39 cards advertise the same headline number.** `free.dailyConversations` and `starter.dailyConversations` are both `5`, and the bullet is generated from that value, so both cards read "Up to 5 customer conversations/day". | `src/lib/entitlements.ts:46,52` | Commercial |
| D-08 | **Mobile nav silently drops four destinations.** `MobileTabBar` renders `items.slice(0, 5)`. For a service tenant with booking on, Appointments takes slot 4 and pushes **My Business, Inventory, My Team and Billing** out. There is no overflow tab, and `account-menu.tsx` exposes only one link — so those pages are **unreachable on a phone**. The code comment claiming the set is "Home/Inbox/Orders/Analytics/Business" is wrong whenever `showBookings` is true. | `app-nav.tsx:83`; `src/app/dashboard/dashboard-nav.tsx:22-40` | Critical |
| D-09 | **Dashboard Home is three mutually exclusive screens**, branching on plan + role: Copilot (Growth+ admin) / EmptyState (no activity) / needs-attention + stats. A Growth owner never sees the needs-attention grid on Home at all. Any "Mission Control" spec that assumes one screen cannot be implemented as written. | `src/app/dashboard/page.tsx:181-259` | High |
| D-10 | **The login page's `<h1>` is the wordmark**, not the page's purpose — the exact grammar of a credential-harvesting page, on the screen where trust matters most. | `src/app/(auth)/login/page.tsx` | High |
| D-11 | **Channel connection is a 3–5 business day concierge request**, not a connection. The screen collects checkboxes and a note, then the owner waits. Competitors complete this in ~20 seconds via an OAuth popup. | `src/app/dashboard/business/channel-setup.tsx` | Critical |
| D-12 | No `pending` / `warning` semantic token exists. Pending state is the only status on Home with no colour signal. | `globals.css:59-92` | Medium |
| D-13 | **The mobile inbox thread scrolls sideways.** Message bubbles are `max-w-[75%]` with no word-break rule, so any unbreakable token — a meeting link `https://meet.google.com/nwm-wwhj-wrf`, an auto-linkified phone number `12345678901` — cannot wrap. The bubble pushes past 75%, the flex row exceeds the viewport, and the thread pans right with the left edge of every bubble cut off. Reproduced in the field. | `src/app/_shared/inbox/conversation-pane.tsx:367` | Critical |
| D-14 | **The Orders business selector is a client-dashboard-only defect — the agency copy is correct and must stay.** `admin/orders/page.tsx:25` selects *all* tenants and only adds `.eq('tenant_id', …)` when one is picked, so on `/admin` the dropdown is honest and "All clients" is accurate vocabulary for an agency. The client dashboard reuses the same `OrdersView` but breaks its contract three ways. (a) **The label lies on first paint:** the server hard-filters to `activeTenantId` (`:37`) while `initialTenantId={null}` (`:61`) makes the dropdown read *"All clients"* — it says all, it shows one. (b) **It desyncs from the topbar:** picking a business calls `getOrdersPageAction`, which is *not* scoped to the active tenant and filters by whatever id the client sends, so rows do change — but the `cn_active_tenant` cookie doesn't, leaving Orders on Business B while the topbar and every other page still say Business A. Picking "All clients" back sends `tenantId: null` and mixes both businesses into a table the initial render can never produce. (c) **Wrong vocabulary:** the user *is* the client. `orders-view.tsx:400-408` even documents the assumption that dashboard callers are single-tenant — `dashboard/orders/page.tsx:58` (`showBusinessColumn={ctx.memberships.length > 1}`) is what violates it. | `src/app/dashboard/orders/page.tsx:37,58,61`; `src/app/admin/orders/orders-view.tsx:400-408,534-556`; `src/app/admin/orders/actions.ts:136-158` | High |
| D-15 | **The free plan's 20-message cap reads as "the AI broke".** After 20 customer messages in one conversation, `aiOrchestrator` sets `handoff = true` with reason `length_limit`, permanently. Every later message short-circuits to handoff before reaching the AI. Toggling handoff off in the inbox does **not** recover it — the cap is re-checked on the next message and fires again. The only working reset is *Erase customer data*, so the sole recovery path is **destructive**. Reported from the field as "the LLM starts hallucinating", which it is not. | `src/services/aiOrchestrator.ts:231-269`; `src/lib/entitlements.ts:47` | Critical |

**Also verify before designing around it:** the earlier guide reported that the Orders "Owner alert"
column reads *Pending* on every row regardless of status. Reproduce it first. If real it is a data
bug in the orders query, not a design task — fix it in that layer and do not paper over it with a
badge colour.

**Reproduce, then file:** the inbox conversation header renders a broken-image placeholder for
Instagram contact avatars (observed in the field). Determine whether the avatar URL is expired,
blocked by referrer policy, or absent, then add a proper initials fallback — do not ship an
`<img>` that can render as a broken icon.

**Not a UI task, but owed:** booking / appointments / meeting-link flows have not been tested
end-to-end (`docs/24`). Schedule that as QA before Stage 9 — M7's two-door hero advertises
Appointments to the market, and it must not be advertised before it is verified.

---

## 2. Token additions

Add to `src/app/globals.css`. Semantic status colours only — these are **not** brand accents and must
never be used decoratively.

```css
:root {
  /* Semantic status. Text variants are darkened to clear 4.5:1 on their own tint. */
  --success:        oklch(0.52 0.12 165);
  --success-text:   oklch(0.45 0.11 165);
  --success-tint:   oklch(0.95 0.03 165);
  --pending:        oklch(0.70 0.15 70);
  --pending-text:   oklch(0.55 0.13 65);
  --pending-tint:   oklch(0.96 0.05 90);
  --danger-text:    oklch(0.50 0.20 27);
  --danger-tint:    oklch(0.95 0.03 27);
}

.dark {
  --success:        oklch(0.72 0.14 163);
  --success-text:   oklch(0.80 0.13 163);
  --success-tint:   oklch(0.27 0.04 165);
  --pending:        oklch(0.78 0.14 75);
  --pending-text:   oklch(0.85 0.12 80);
  --pending-tint:   oklch(0.28 0.05 75);
  --danger-text:    oklch(0.78 0.15 25);
  --danger-tint:    oklch(0.28 0.06 25);
}
```

Register each in the `@theme inline` block (`--color-success: var(--success)` etc.) so Tailwind
generates the utilities.

> **The oklch values above are starting points, not measurements.** Before closing this task, verify
> every `*-text` on its matching `*-tint`, in both themes, at ≥4.5:1. Adjust lightness only — keep
> hue and chroma so the palette stays one family. §10 has the measurement method.

**Marketing stage grounds** (fixes D-04) — these are page-section backgrounds, added alongside:

```css
:root {
  --stage-ink:   oklch(0.20 0.02 172);  /* near-black, green-tinted — never pure #000 */
  --stage-ink-fg:oklch(0.96 0.005 165);
  --stage-deep:  oklch(0.42 0.09 165);  /* saturated emerald, for the "after" stage */
  --stage-deep-fg: oklch(0.98 0.005 165);
  --stage-warm:  oklch(0.95 0.045 85);  /* warm sand, for the channel stage */
  --stage-warm-fg: oklch(0.25 0.03 80);
}
```

Dark-theme values for these are **deliberately near-identical** — the marketing stages are a
committed visual sequence, not a themed surface. Set them to the same values under `.dark` and let
the intervening light sections carry the theme.

---

## 3. Stage 1 — Marketing page

Ship in this order; each task is independently deployable.

### M1 — Mobile navigation (D-01)

`src/app/page.tsx:110-129`.

Add a hamburger visible below `md` that opens a sheet containing **How it works, Features, Pricing,
FAQ, Try it free, Sign in**. Use the existing shadcn sheet/dialog primitive if one is present in
`src/components/ui/`; otherwise a `<details>`-driven panel is acceptable — do not add a dependency.

- Trigger is ≥44×44 with an accessible name (`aria-label="Menu"`).
- Panel closes on link activation and on `Escape`.
- Desktop markup is unchanged.

**Done when:** at 390px width every section is reachable from the header without scrolling the page.

### M2 — Hero demo above the fold on mobile (D-05)

`src/app/page.tsx:148-171`.

On mobile, order becomes: badge → H1 → **HeroVisual** → subparagraph → CTAs. Desktop keeps the
current two-column arrangement. Use `order-*` utilities at the `lg` breakpoint rather than
duplicating the markup — one DOM, two orders.

Shrink the mobile hero so the demo's first message is visible at 664px: reduce `py-20` to `py-10` on
mobile, and cap the visual's mobile height so at least one exchange lands above the fold.

**Done when:** at 390×664, a message bubble is visible without scrolling.

### M3 — Tap targets outside the dashboard (D-03)

`src/app/globals.css:201-223`.

The current `nav a::after { content: none }` escape hatch exists because the dashboard tab bar's
links are already full-height. Narrow it instead of disabling the rule page-wide:

- Scope the exclusion to the tab bar specifically (add a `data-slot="tab-bar"` attribute on
  `MobileTabBar`'s `<nav>` and key off that), so marketing header anchors get the 44px treatment.
- Add `summary` and `a` to the expansion selector list. Keep the pseudo-element non-painting.
- Verify the FAQ `<summary>` rows and footer links now measure ≥44px on a coarse pointer.

**Done when:** a Playwright sweep at 390px reports zero interactive elements under 44px on `/`,
`/login`, `/signup`, `/try`.

### M4 — Section heading and type floor (D-02, D-06)

- Add an `<h2>` to `#features` matching the other sections' pattern (`Badge` + `displayFont` H2 +
  supporting paragraph). Suggested: **"Everything runs in one place."**
- Add `#features` to both the header nav and the footer Product column.
- Raise `text-[0.7rem]` at `page.tsx:107` to `text-xs` (12px).

**Done when:** heading order is H1, H2×5 with no section missing one; no text below 12px.

### M5 — Colour-blocked stages (D-04)

This is the change that fixes "flat and samey". Assign each section a **ground**, so scrolling the
page moves through distinct stages instead of one continuous surface:

| Section | Ground | Foreground |
|---|---|---|
| Hero | `--background` (unchanged) | default |
| Channel strip | `--stage-ink` | `--stage-ink-fg` |
| How it works | `--background` | default |
| Features | `--stage-warm` | `--stage-warm-fg` |
| Before/after (new, M6) | `--stage-deep` | `--stage-deep-fg` |
| Pricing | `--card` | default |
| FAQ | `--background` | default |
| Final CTA | `--stage-ink` | `--stage-ink-fg` |

Rules: adjacent stages never share a ground. On a dark stage, badges, card borders and the
`--primary` CTA must be re-checked for contrast — `--primary` at `oklch(0.52 …)` is too dark on
`--stage-ink`; use the `.dark` variant `oklch(0.72 0.14 163)` for CTAs sitting on dark stages.

**Done when:** the page has at least four distinct grounds and every stage passes AA for body text.

### M6 — Before / after section (new)

Insert between Features and Pricing. Two cards, side by side on desktop, stacked on mobile.

- **Left, muted card — "Right now"**: four pains, short and concrete, in the owner's own words.
  Draw from the FAQ copy already in `page.tsx:70-95` so the voice matches. e.g. *"Answering the same
  price question forty times a day."*
- **Right, `--stage-deep` card — "With ClerkNest"**: the four corresponding gains, each a plain
  outcome, not a feature name.

This is the single highest-converting section pattern for a non-technical audience: it sells the
problem before the mechanism. Animation spec in §6.

### M7 — Two-door hero

`page.tsx:149-168`. Add a two-option control above the CTAs — **"I sell products"** / **"I take
bookings"** — that re-renders `HeroVisual` with the matching script.

This does three jobs in one component: it surfaces the Appointments capability (already built, see
`docs/24`, currently invisible on the marketing page), it is the page's first user-controlled
interaction, and it lets a service business see itself in the demo.

Requires `HeroVisual` (`src/app/_landing/hero-visual.tsx`) to accept a `variant` prop and hold a
second script. Keep the existing product script as the default.

### M8 — Trust row at the fold

A single row directly under the hero CTAs, above the fold on desktop: channel logos (already in
`_landing/platform-icons.tsx`), and any **true** proof — businesses live, messages handled, average
response time. If no number is honest yet, ship the channel logos and the "no card required" line
only. **Do not invent social proof.**

### M9 — Pricing honesty (D-07)

`src/lib/entitlements.ts:51-56`. Starter must not advertise the same headline number as Free. Choose
one, in `ENTITLEMENTS`, so enforcement and copy move together:

- Raise `starter.dailyConversations` (e.g. `50`), **or**
- Set it to `Infinity` and let message-length + channel count be the Free/Starter divide.

This is a **pricing decision, not a UI decision** — surface the two options and let the owner pick
before implementing. Do not change the number unilaterally.

Also add a `--pending`-toned "Most popular" treatment distinct from the primary CTA so the
highlighted card reads as guidance rather than a second button.

---

## 4. Stage 2 — Auth (D-10)

`src/app/(auth)/login/page.tsx`, `signup/`, `signup/complete/`, `login/verify-code-form.tsx`.

### A1 — Fix the page grammar

The `<h1>` becomes the **purpose**, not the wordmark:

- Login: `Sign in to ClerkNest` (h1) with the logomark above it as an image, not a heading.
- Signup: `Create your ClerkNest account`.

A centred card containing only a logo and two fields is the visual grammar of a phishing page. This
one change removes most of that read.

### A2 — Split-screen shell

Replace the centred `max-w-sm` card with a two-column layout on `lg+`:

- **Left**: the form, left-aligned, generous type, on `--background`.
- **Right**: a `--stage-deep` panel carrying one concrete proof — a static rendering of the hero
  conversation, or a single outcome line. Not a stock illustration.
- Below `lg`: form only, full width, panel hidden.

### A3 — Say what happens next

Above the form, one line: *"Use the email your ClerkNest setup was sent to."* Under the submit
button, the support route. Every auth screen must answer "what if this doesn't work".

### A4 — Keep the OTP-not-link decision, and explain it

`verify-code-form.tsx` deliberately emails a typed code rather than a clickable link, so an inbox
security scanner cannot burn the one-time code before the real user reaches it. That is a good
decision that currently reads as friction. Add one line of copy on the verify screen explaining that
the code is typed on purpose. **Do not replace it with a magic link.**

### A5 — Tap targets

Inputs and the submit button on auth screens currently measure ~32px. These are the highest-stakes
controls in the product. Set them to `h-11` (44px) explicitly rather than relying on the M3
pseudo-element, so the visual size matches the hit area.

---

## 5. Stage 3 — Channel connection (D-11)

This is the highest-value item in this document. The current flow is architecturally excellent — it
collects **strictly less** than competitors do, holds no credentials, and honours locked decision #2
— and it converts badly anyway, because it ends in a 3–5 day wait.

Three stages. Ship C1 now; C2 is the real fix; C3 is a later unlock.

### C1 — Reframe the concierge flow (this week, no backend work)

`src/app/dashboard/business/channel-setup.tsx`.

The security posture is the strongest selling point in the product and it is currently buried in a
paragraph. Lead with it.

- Promote the "You never need to share passwords or API keys with us" line to a **bordered callout at
  the top of the screen**, with a link to a new `/security` page explaining, in the owner's language,
  exactly what ClerkNest can and cannot see.
- Replace the flat "requested" state with a **visible three-step tracker**: Requested → We're
  connecting → Live. Show the timestamp of the last change. An owner who can see progress waits;
  an owner staring at an unchanged checkbox assumes it broke.
- Set an explicit expectation with a date, not a range: *"We'll have this live by Tuesday 12 Aug."*

**Done when:** a tenant who has requested setup can tell, from the screen alone, what stage they are
at and when it completes.

### C2 — Facebook Login for Business (the real fix)

Replace the request form with an OAuth popup for **Instagram and Messenger**. This does **not**
require any partnership — Facebook Login for Business is open to any developer app. The gate is App
Review for Advanced Access, which is free and open to everyone.

Flow, matching the architecture already in `docs/06-INTEGRATIONS`:

1. Owner clicks **Connect Instagram**. Popup to Meta.
2. Owner picks their account and grants permissions, entirely on Meta's domain.
3. Meta redirects to `/api/webhooks/meta`-adjacent callback with a short-lived code.
4. **Server-side only**: exchange the code, store the long-lived token in Vault, write the page /
   IG id to `tenants`. The client never sees a token. Locked decision #2 holds.
5. Screen flips to Connected with the account name.

Prerequisites, all free:
- App Review submission with a screencast of the flow
- A public privacy policy (`/privacy` exists) and a **data-deletion callback** endpoint
- A Meta test user for the reviewer

Keep the concierge path as the fallback for WhatsApp until C3, and for any owner who prefers it.

> Meta renames these programmes frequently and this spec's knowledge runs to mid-2026. Verify current
> names and scopes at `developers.facebook.com` before implementing. The *architecture* — OAuth popup
> → server-side exchange → Vault → never touch a credential — is the stable part.

### C3 — WhatsApp Embedded Signup (later)

The only genuinely gated piece. Requires **Tech Provider** registration. Until then WhatsApp stays on
the C1 concierge path. The Meta Business Partner badge is marketing/directory only — it unlocks no
API and is not on the critical path for any of this.

---

## 6. Motion spec

Motion here is **state change driven by scroll position or a click**, never ambient decoration.
Looping decorative animation is the single clearest tell of a generic page; a scroll-triggered state
change reads as crafted. The existing `.animate-float` loop (`globals.css:158-176`) is the exception
to grandfather, not a pattern to extend.

### 6.1 Timing

| Class | Duration | Curve |
|---|---|---|
| Micro (hover, toggle, pill) | 120–150ms | `ease-out` |
| Panel / sheet / accordion | 200–250ms | `ease-out` in, `ease-in` out |
| Scroll-triggered stage reveal | 350–450ms | `ease-out` |
| Stagger between siblings | 60ms | — |

Nothing bounces. Nothing overshoots. No page-transition slides.

### 6.2 The set — build these, in this order

1. **Hero demo types instead of plays** (`_landing/hero-visual.tsx`). Character-by-character reveal
   on the customer message, a real typing indicator, then the reply lands at `scale(0.96) → 1` with
   opacity over 180ms. Same script, dramatically more alive. Highest value per line changed.
2. **Before/after reveal** (M6). On scroll into view, the `--stage-deep` card goes
   `scale(0.96) → 1` and `translateY(12px) → 0` over 400ms, then the four gain rows stagger in at
   60ms. **One orchestrated moment beats twenty scattered effects** — this is the page's motion
   centrepiece.
3. **Sticky header shrink.** Past the hero, header height 72px → 56px and the wordmark lockup
   collapses to the logomark alone. Transform and opacity only.
4. **Scroll-pinned channel re-skin.** A `position: sticky` section where the phone stays fixed and
   the chat skin cross-fades WhatsApp → Instagram → Messenger as the section scrolls. Pairs with the
   `--stage-warm` ground from M5. Biggest single "wow", highest effort — do it last.
5. **Count-up on the trust row** (M8), triggered once on entry, only for numbers that are real.
6. **Two-door hero switch** (M7) — the transition between demo scripts is a 200ms cross-fade, not a
   slide.

### 6.3 Rules

- **Only `transform` and `opacity`.** Never animate `height`, `top`, `width`, or `box-shadow`.
- Use `IntersectionObserver` for discrete triggers. Do **not** continuously scrub on scroll except in
  item 4, which must be capped and tested on a low-end Android profile.
- Every animation is triggered, completes, and stops. Nothing runs forever.
- **No** parallax, no floating gradient blobs, no scroll-jacking. There is already one overflowing
  decorative radial-gradient div on mobile — remove it rather than adding siblings.
- `prefers-reduced-motion: reduce` disables all of it and renders the final state immediately.
  `hero-visual.tsx` already honours this; extend the same guard to every new animation.
- Nothing in `/dashboard` gets scroll animation. Operational screens animate state changes only.

---

## 7. Stage 4 — Dashboard

### 7.1 Resolve the three-branch Home first (D-09)

Nothing else on Home can be specified until this is settled. `src/app/dashboard/page.tsx:181-259`
currently renders one of three different screens depending on plan and role.

**Target:** one Home, with sections that appear or disappear — not three screens.

```
Welcome back, {business}                     ← PageHeader (existing)
[quota banner, if plan is limited]           ← existing, keep
──────────────────────────────────────────
Needs attention                              ← ALWAYS, all plans/roles
  · one row per item, human sentence + one action
  · or "Nothing needs you right now." when clear
──────────────────────────────────────────
Your clerks                                    ← strip, below the queue
──────────────────────────────────────────
Ask ClerkAI                                   ← Copilot: Growth+ admin
  (or the upgrade teaser below Growth — existing copy is good)
──────────────────────────────────────────
Last 30 days                                 ← stats, tiered per 7.2
```

The Copilot moves from *replacing* Home to *being a section of* Home. The needs-attention queue is
never hidden from anyone — a paying owner losing the queue because they upgraded is backwards.

### 7.2 Needs-attention as a queue, not a KPI grid

`page.tsx:206-224` renders four equal count tiles. Counts are a dashboard answering "how many";
owners open the app asking "what do I do". Convert to rows:

- Each row: a **human sentence** — *"Talha — waiting on payment"*, *"Ayesha's order needs your
  approval"* — plus one primary action button and a relative timestamp.
- Cap at five rows with "See all N" beneath.
- Empty: *"Nothing needs you right now."* (§7.3 voice).
- Tapping the row body opens the detail sheet (the §0.1 depth layer). The button acts directly.

### 7.3 Copy substitutions

Apply everywhere, including error toasts and server action messages.

| Never show | Show instead |
|---|---|
| Webhook failed | We couldn't reach Instagram. We'll keep trying. |
| 3 active workflows | Following up with 3 customers |
| 0 records found | Nothing needs you right now. |
| Sync error | Instagram disconnected — reconnect to keep replying |
| Token expired | Your Instagram connection needs renewing |
| Inventory | My Stock |
| Conversations handled (30d) | Customers answered this month |
| Active conversations (24h) | Chats happening today |

Rename `Inventory` → `My Stock` in `dashboard-nav.tsx:37` (`shortLabel` already reads `Stock`).

### 7.4 Metric tiering

`page.tsx:228-257` renders three or four equal cards. Promote **one** to hero size — the number that
proves the product is working, which is orders this month for a product business and appointments
booked for a service one. The rest drop to a compact row. One hero number per screen.

### 7.5 "Your clerks" strip

Per the product decision: the AI-employee metaphor lives on the marketing page, in onboarding, and as
a **strip below the needs-attention queue** — never as the greeting.

A horizontal row of compact cards, one per active capability (Replies, Orders, Bookings). Each shows
a name, a live state, and one true recent outcome: *"Recovered a Rs 4,200 order — 40 min ago"*.
Tapping opens the detail sheet with settings and the log.

**Rule:** if there is no real outcome to show, show the state only. Never fabricate an event.

### 7.6 Mobile navigation bug (D-08) — do this before any other dashboard work

`app-nav.tsx:83`, `dashboard-nav.tsx:22-40`.

`items.slice(0, 5)` currently makes My Business, Inventory, My Team and Billing unreachable on a
phone for any service tenant with booking enabled. Fix:

- If `items.length > 5`, render **four** items plus a fifth **"More"** tab that opens a sheet
  containing every remaining destination.
- Never silently truncate. The tab bar must always be able to reach 100% of the nav.
- Correct the stale comment in `dashboard-nav.tsx` — it describes a set the code does not produce.

**Done when:** at 390px, on a service tenant with `booking_enabled`, every sidebar destination is
reachable within two taps.

### 7.7 Status pills

Once §2 tokens land, replace ad-hoc colour classes with a single `StatusPill` component using
`--success` / `--pending` / `--danger` and their `-text` / `-tint` pairs. Never encode state by
colour alone — every pill carries a word.

---

## 7A. Field bugs — fix these before any cosmetic work

These are live defects, not design debt. They ship first.

### F1 — Stop the inbox thread panning sideways (D-13)

`src/app/_shared/inbox/conversation-pane.tsx:367`.

Add `break-words` (`overflow-wrap: break-word`) and `min-w-0` to the message bubble. Long URLs and
linkified phone numbers must wrap inside the bubble instead of widening it. Add `overflow-x: hidden`
to the thread's scroll container as a backstop so no future content can pan the view.

**Done when:** at 390px, a message containing `https://meet.google.com/nwm-wwhj-wrf` wraps, and the
thread has zero horizontal scroll.

### F2 — Remove the Orders business selector from the client dashboard (D-14)

> **The selector belongs on the agency side, and it is already there and already correct.**
> `/admin/orders` fetches every tenant, filters only when one is chosen, honours a `?tenant=` deep
> link, and calls them "clients" — which, for the agency, they are. **Change nothing in
> `src/app/admin/`.** This task is entirely about the client dashboard's reuse of the component.

1. **Turn it off in the client shell.** `src/app/dashboard/orders/page.tsx:58` →
   `showBusinessColumn={false}`. That drops both the dropdown and the redundant Business column (with
   the page scoped to one tenant, every row in that column says the same thing anyway). The topbar
   `TenantSwitcher` becomes the single control for "which business" — one concept, one control, and it
   moves the `cn_active_tenant` cookie so the whole app follows, not just this page.
2. **Fix the residual vocabulary.** Sweep `orders-view.tsx` for agency strings that reach the client
   shell regardless of this flag ("client", "clients"). Where a string is genuinely dual-audience, put
   it behind a prop with the agency wording as the default — do not assume the shell.
3. **Do not "fix" it by widening the query.** The tempting alternative — drop
   `.eq('tenant_id', activeTenantId)` and fetch across `ctx.memberships` — gives a multi-business owner
   two competing business selectors that can disagree, and leans the paging path entirely on RLS
   (`actions.ts:136-158` applies no membership check of its own). Keep the explicit tenant filter.

**Non-goal / do not regress:** the agency's own selector, the `?tenant=` deep link into it, and
`showBusinessColumn`'s default of `true` must all keep working. `/admin/orders` passes no
`showBusinessColumn` prop and relies on that default.

**Done when:** on `/dashboard/orders` there is exactly one business control on screen (the topbar
switcher), the word "client" appears nowhere in the client shell, and `/admin/orders` still shows the
full client dropdown with `?tenant=<id>` pre-selecting correctly.

### F3 — Make the conversation-length cap legible and recoverable (D-15)

This is the highest-severity item in this document — it currently looks like the AI is broken, and
the only escape is deleting customer data.

Three changes:

1. **Say why, in the inbox.** When a session is handed off with reason `length_limit`, the
   conversation pane shows a banner: *"This chat reached your plan's limit of 20 messages. Reply
   yourself, or upgrade to let ClerkAI keep going."* — with the upgrade link. Today the owner sees an
   unexplained handoff. The reason is already stored; surface it.
2. **Give a non-destructive reset.** *Erase customer data* must not be the recovery path for a quota.
   Add an explicit owner action — "Let the AI continue this chat" — that resets the counted window
   for that session. If the product decision is that free-plan owners should *not* get that, then the
   banner must say so plainly and link to billing instead. Either is fine; the current state, where
   the only working lever is destructive, is not.
3. **Fix the toggle's false promise.** The handoff switch in the conversation header implies turning
   the AI back on works. Over the cap it does not — the next message re-triggers the limit. Disable
   the switch in that state with a tooltip explaining why, so the control never lies.

**Done when:** an owner who hits the cap can tell what happened, what it costs, and what to do, from
the inbox alone — without erasing anything.

---

## 8. Explicitly out of scope

From the earlier guide, deliberately **not** doing:

- **AI Employee cards as the Home hero.** Superseded by §7.5. It puts an abstraction between the
  owner and their task; the metaphor's job is marketing, and the dashboard's job is to be useful on
  the 400th visit.
- **The Customer Brain third column.** Revisit after §7 ships. A three-column inbox has no defined
  phone behaviour and the current spec doesn't give it one.
- **A five-colour sentiment palette.** Two semantic colours plus neutral is the ceiling until there
  is a demonstrated need. More colours is more to learn.
- **Renaming the product.** Keep ClerkNest. Add a tagline instead.
- **Hex tokens.** See §0.3.

---

## 9. Build order

Each stage is independently shippable. Do not start a stage before the previous one builds green.

| # | Stage | Tasks | Why here |
|---|---|---|---|
| 0 | **Field bugs** | F1, F2, F3 | Live defects seen by real users. F1 is one line. F3 is the worst bug in the product. Nothing cosmetic ships before these. |
| 1 | Marketing critical | M1, M2, M3, M4 | Fixes the two Critical defects blocking phone signups. No new design needed. |
| 2 | Dashboard nav | 7.6 | Critical, self-contained, one file. |
| 3 | Tokens | §2 | Everything visual downstream depends on it. |
| 4 | Auth | A1–A5 | Small, high trust impact, no backend. |
| 5 | Marketing design | M5, M6, M8, M9 | The "sells itself" work. Needs §2 tokens. |
| 6 | Motion | §6.2 items 1–3 | Needs M6 to exist. |
| 7 | Channel C1 | §5 C1 | No backend. Ships the trust story immediately. |
| 8 | Dashboard | 7.1, 7.2, 7.3, 7.4, 7.7 | Largest surface. Needs tokens + settled Home shape. |
| 9 | M7, 7.5 | Two-door hero, crew strip | Positioning polish. |
| 10 | Motion 4 | Scroll-pinned re-skin | Highest effort, purely additive. |
| 11 | C2 | Facebook Login for Business | Backend + App Review lead time. Start the review submission during stage 1. |

**Start the Meta App Review paperwork at stage 1**, in parallel — review turnaround is the long pole
and nothing else depends on it.

---

## 10. Definition of done

Per task:
- `npm run build` passes. Not `tsc --noEmit` alone — server/client boundary errors only appear in a
  full build.
- No new file imports `lib/supabase/service.ts` into a client component.
- No hex colour added to `globals.css` or any component.
- Both themes checked. Every new colour is defined as a token in **both** `:root` and `.dark`.
- `prefers-reduced-motion: reduce` renders the final state with no animation.

Per stage, at 390×664 and 1440×900:
- Zero interactive elements under 44px on a coarse pointer.
- No horizontal document scroll.
- Every nav destination reachable within two taps.
- Body text ≥12px, all text ≥4.5:1 against its actual background.

**Contrast measurement.** Computed styles resolve to `lab()` in this stack, and parsing those
components as RGB yields wildly wrong ratios. Paint the colour to a canvas and read it back:

```js
const c = document.createElement('canvas').getContext('2d');
c.fillStyle = getComputedStyle(el).color;   // resolves lab()/oklch() → sRGB
c.fillRect(0, 0, 1, 1);
const [r, g, b] = c.getImageData(0, 0, 1, 1).data;   // then standard WCAG luminance
```
