# 19 — Premium UI, Onboarding Automation & Growth

> Status doc for the 2026-07 overhaul (Opus session). Four approved tracks, built in order.
> Design direction (user-approved): **light-first, deep-emerald accent on warm sage neutrals,
> dark theme as a personal-preference toggle.** Clients are non-technical — every flow must
> work with minimal input, and onboarding must not bottleneck on manual agency work at scale.

## Track U — Premium UI

### U1. Design DNA — ✅ SHIPPED (`6906c24`)
- `globals.css`: emerald/sage token palette (light + dark), multi-hue charts, radius 0.75rem.
- next-themes wired (`ThemeProvider`, default light) + one-tap `ThemeToggle` in `AppTopbar`.
- Space Grotesk promoted to app-wide `--font-heading`.

### U2. Navigation & mobile shell — ✅ SHIPPED
- Shared `components/app-nav.tsx` (`SidebarNav` + `MobileTabBar`, one `NavItem[]` drives both);
  `dashboard-nav.tsx`/`admin-nav.tsx` rebuilt with lucide icons + emerald accent bar; dashboard
  gains the previously-unreachable Home item (exact match).
- Both shells: sidebar `hidden lg:flex` + Logomark brand; fixed bottom tab bar `< lg` (first 5
  items — Team/Settings stay desktop-only); `main` gets `pb-16 lg:pb-0`; topbar shows
  Logomark + CrewNest on mobile.
- PWA: `app/manifest.ts` (standalone, `/dashboard` start, `#0E7A5A`), `public/icons/` set
  (192/512 + maskable + apple-touch), root-metadata icons. No service worker/offline (deliberate —
  realtime app, stale cache would mislead).

### U3. Landing page & commercial surfaces — ✅ SHIPPED
- `app/page.tsx` rebuilt: hero (kept) → channel strip (honest social proof until real logos) →
  how-it-works (3 steps) → feature grid → pricing from `PAYWALL_PLANS` (Starter highlighted) →
  FAQ (native `<details>`, 6 owner-voice questions) → closing CTA → real 3-column footer.
- Admin login removed from public navbar + footer (reachable at /admin directly); navbar gains
  anchor links (How it works / Pricing / FAQ, `md+`).
- `/privacy` + `/terms` live (shared `_landing/legal-page.tsx` shell) — Meta App Review
  prerequisite; contact email kraftnestco@gmail.com; linked in footer.
- Still open: surface order `review_rating` aggregate as social proof once real data exists.
- Gotcha: Turbopack JSX dropped some inline spaces after `</strong>` before em dashes — use
  explicit `{' — '}` when it bites (see privacy/page.tsx).

## Track O — Onboarding automation (non-technical clients, zero-bottleneck agency)

Target flow: client gives **business name + website/social link + WhatsApp number** → everything
else is generated, reviewed once, and live.

- **O1. Prompt Architect**: LLM pass composes the system prompt from wizard fields (tone, persona,
  boundaries, escalation). Raw textarea becomes "advanced mode". Also regenerable from the
  dashboard. [OPUS]-grade prompt engineering.
- **O2. Magic Import**: paste website URL (later: FB page via token) → server-side fetch →
  LLM extracts business type, catalogue draft, hours, FAQs, tone → prefills the entire intake
  wizard for one-click confirm. [OPUS] extraction prompt.
- **O3. Meta embedded signup**: replace manual token paste with click-to-connect OAuth
  (locked decision said "later" — pulled forward; token paste is the step non-technical clients
  cannot do). Vault columns unchanged.
- **O4. Agency provisioning**: one admin form = tenant + magic-import + prompt-architect + invite
  email in a single action, so onboarding a client is minutes, not sessions.

## Track I — Inventory lite

Approve/reject alone is NOT enough (damage happens before rejection; AI keeps selling sold-out
items). Scope: optional `in_stock`/`quantity` per catalogue item (inside `catalog_data` JSON),
prompt grounding ("unavailable — offer alternative"), auto-decrement on confirmed order,
low-stock notification, one-tap restock. Explicitly NOT variants/warehouses.

## Track G — Growth mechanics

- "Powered by CrewNest" badge + referral link on free-plan web widget (paid removes it).
- Referral credits (give a month / get a month); annual pricing (2 months free).
- Per-vertical `/try` templates (salon, boutique, bakery…) as SEO landing pages.
- Later: white-label agency tier (~$199+) — admin panel already 80% of it.

## Research findings (2026-07 competitive/ecosystem scan)

1. **Competitors are flow-builders, not AI employees.** Wati / Interakt / Gallabox / AiSensy /
   SleekFlow sell shared inboxes + drag-and-drop chatbot builders + broadcasts (₹2.5k–$399/mo).
   None lead with a grounded autonomous agent that captures orders end-to-end. CrewNest's
   positioning — "AI employee, not chatbot builder" — is genuinely differentiated; never ship a
   flow-builder UI, it's the old paradigm and a maintenance sink.
2. **Tidio Lyro validates Magic Import** — its whole onboarding is "paste website URL, AI learns
   it, live in 10 min." Its known weakness (widget live ≠ answers well) is exactly what our
   Prompt Architect + auto-KB-learning loop should beat.
3. **We under-use the WhatsApp platform.** WhatsApp Flows (multi-screen in-chat forms: date
   pickers, dropdowns, file upload, up-to-30-product carousels; payments in IN/BR) can do
   in-chat **address collection** (cuts COD address errors), **appointment booking** (slot list +
   confirm — unlocks the salon/clinic vertical with no calendar integration), and catalog
   carousels. Phase these in after Track O.
4. **Embedded signup has lead time.** Requires Meta Tech Provider status + advanced-access App
   Review on `whatsapp_business_management`; default cap 10 new client onboards per rolling
   7-day window. Start App Review EARLY — it gates scale regardless of our code being ready.
5. **Outcome pricing is normalized.** Intercom Fin charges $0.99/resolution (min 50/mo) and was
   acquired at ~$3.6B on that model — a per-captured-order lane for micro-merchants is
   market-proven, not exotic.
6. **Pakistan market reality (our wedge):** social commerce heading toward ~35% of online retail
   by end-2026, deals close inside DMs, COD dominates with brutal RTO (return-to-origin) rates.
   **CrewNest's quantifiable ROI story: AI confirmation of order + address before dispatch cuts
   RTO.** Sell that number, not "AI chat." JazzCash/EasyPaisa rising → manual-transfer flow is
   the right rail today; inventory mismatch across platforms is a top seller pain → Track I.
7. **Vertical AI receptionists are standalone products** (Retell $0.07/min, AgentZap, Voiceoc) —
   WhatsApp Flows booking + reminders absorbs that whole category for our booked-services
   tenants at zero marginal price.

## Track A — Vertical automation matrix (full front-office automation per niche)

Goal (user, 2026-07-23): a tenant's business should run itself through CrewNest. Per-niche
requirements, mapped to what exists vs. what's needed:

| Niche | Runs today | Missing for "fully automated" |
|---|---|---|
| **Product retail** (boutique, jewelry, electronics) | catalogue grounding, order capture, COD/transfer payments, approval, review collection | stock truth (Track I), proactive delivery-status pushes, courier/tracking handoff (PK: TCS/Leopard/Trax — phase 2), receipt/invoice message |
| **Food** (restaurant, bakery, home kitchen) | hours, catalogue, orders | daily-menu quick-swap (stock toggle covers), prep-time quote, delivery zone/radius check, order cutoff enforcement |
| **Booked services** (salon, clinic, tutor, repair) | `booking_link` handoff only | real slot booking: internal availability model or calendar link deep-integration, reminders, reschedule/no-show flow |
| **Custom-quote services** (tailor, printer, decor) | media intake + human review + custom orders | structured quote object: AI gathers specs → human prices once → AI closes & collects |
| **High-ticket lead-gen** (real estate, autos) | generic chat | lead qualification mode: capture budget/location/intent → scored lead to owner, no "order" pretense |
| **Digital products** | — | post-payment auto-delivery of link/file after verification |

Cross-cutting automation (applies to every niche, ordered by leverage):
1. **Proactive lifecycle messages** — order confirmed → packed → delivered pushes; payment
   reminder → auto-cancel window (already in edge-case backlog).
2. **Payment-proof auto-verification** — vision pass on receipt screenshots; auto-approve under
   a tenant-set threshold, queue above it.
3. **Owner daily digest** — WhatsApp summary to the tenant each morning (chats, orders, revenue,
   items low on stock, pending approvals). Makes CrewNest the daily habit.
4. **Auto-KB learning** — mine human-handoff resolutions into suggested FAQ entries the tenant
   approves with one tap (closes the "AI gets smarter" loop).
5. **Re-engagement broadcasts** — abandoned checkout nudge, restock alerts (requires WhatsApp
   template-message opt-in handling — compliance-gated, phase 2).
6. **Business-type aware intake** — `business_type` (product/service) already exists; extend to
   niche presets that pre-wire the right toolset + prompt skeleton per row above.

## Edge-case backlog (from the commercial audit)
- Meta token expiry → covered by parked Stage P (docs/15) — schedule after Track O.
- Holiday/vacation mode (pause AI + away message).
- Unpaid manual-transfer orders: reminder → auto-cancel window.
- Free-cap hit mid-day: graceful customer message + tenant upsell nudge.
- Block/spam control on a session.
