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

- **O1. Prompt Architect** — ✅ SHIPPED. `services/ai/promptArchitect.ts` (mirrors `catalogueParser.ts`:
  `server-only` → `getLlmKey` → `provider.chat` → `usage_logs`) composes ONLY the persona layer —
  identity/voice/scope/boundaries — from the owner's guided answers (one-liner + tone chip + optional
  do's/don'ts). Critically it must NOT recite catalogue/hours/payments/policies or restate guardrails;
  `promptBuilder.ts` injects all of those separately and a duplicate here would drift. Shared
  `components/intake/prompt-architect.tsx` (guided fields + Generate + collapsible raw "advanced"
  textarea) is used by the tenant wizard (`intake-wizard.tsx` step 1) AND the agency editor
  (`intake-form.tsx` §2); both call `generateSystemPromptAction` (tenant-scoped, in intake `actions.ts`).
  Regenerable anytime (the dashboard reopens the same wizard). Public demo has no tenant/LLM key, so
  `PromptArchitect` degrades to the plain textarea when `onGenerate` is absent — demo path unchanged.
- **O2. Magic Import** — ✅ SHIPPED. `services/ai/magicImport.ts` (mirrors `catalogueParser.ts`:
  `server-only` → SSRF-guarded fetch → conservative extract-only LLM call → `usage_logs`) reads the
  owner's website/FB/IG page and returns a draft `{business_type, system_prompt, catalog_freeform_text,
  knowledge_base}`. The extraction prompt transcribes **only** what's on the page (never invents prices/
  hours/policies); the persona reuses the O1 Prompt Architect so imported and hand-built tenants match.
  SSRF guard resolves DNS + blocks loopback/private/link-local/CGNAT/multicast (v4+v6) and re-validates
  every redirect hop (bounded loop, 8s timeout, 1.5 MB / 12 k-char caps). Server action
  `importFromUrlAction` (tenant-scoped auth, in intake `actions.ts`); shared `components/intake/
  magic-import.tsx` (URL box → Import). `dashboard/business/business-intake.tsx` overlays the returned
  draft onto the tenant prop and remounts `IntakeWizard` via `key` so its mount-time initializers pick
  up the values; **nothing persists until the owner completes the existing Save**. FB-page-via-token
  import stays for after Meta embedded signup (O3).
- **O3. Meta embedded signup**: replace manual token paste with click-to-connect OAuth
  (locked decision said "later" — pulled forward; token paste is the step non-technical clients
  cannot do). Vault columns unchanged.
- **O4. Agency provisioning** — ✅ SHIPPED. One admin action provisions a client end to end:
  `app/admin/clients/quick-provision-actions.ts` (`quickProvisionAction`, platform-admin gated)
  creates the tenant with a fresh `pk_live_` widget key, then — all best-effort, each failure a
  non-fatal warning so a bad import never blocks the tenant — runs O2 **Magic Import** from the
  supplied website/social URL (system prompt + business type + freeform catalogue → `catalog_data`
  via `parseCatalogueFreeform`, + knowledge base), re-embeds via `ingestTenantKnowledge` in
  `after()`, and sends the client a `tenant_admin` invite. Only the tenant insert is fatal. UI:
  `quick-provision-dialog.tsx` (Sparkles trigger) with a success screen showing the widget key
  (copy button) + any warnings; wired beside `NewClientDialog` on `admin/clients/page.tsx`. Turns
  onboarding from a multi-session chore into one form.
- **O5. Business Copilot** — ✅ SHIPPED. A Claude-style chat at the top of `dashboard/business`
  (`components/copilot/business-copilot.tsx`) where the non-technical owner types plain language
  ("add bridal makeup for 15000", "close 24–26 Dec for Eid", "we take bank transfer now", "make my
  assistant sound more premium") and the copilot proposes the exact profile edit as a
  **ProposedChangeCard** the owner commits with one tap. It's the friendly front door; the intake
  wizard stays underneath as the precise/manual editor. Reuses O1 Prompt Architect and O2 Magic
  Import as tools.
  - **Safety spine — propose/apply split.** The LLM **never writes to the DB**; it only proposes a
    structured `CopilotPatch`, and a deterministic, auth-checked applier commits it. Two server
    actions in `app/dashboard/business/copilot-actions.ts`, both gated exactly like the intake actions
    (`getCallerContext` → `assertTenantAccess` → require `platform_admin` or `tenant_admin` of THIS
    tenant): `copilotTurnAction` runs the bounded tool-calling loop (DB-read-only w.r.t. tenant data —
    writes only a `usage_logs` row) and returns a staged patch; `applyCopilotPatchAction` is the ONLY
    writer — it re-checks auth, hard-validates the patch against the allowlist, and does a **partial**
    `.update()` through the RLS-scoped authenticated client so untouched settings are never reset.
  - **Access tiers** (`services/ai/copilot/tiers.ts`, the single source of truth): **Editable** —
    persona, catalogue, knowledge/FAQ, weekly hours + holiday closures & timezone, business basics,
    custom orders, media/voice. **Money (flagged)** — payment settings; the preview card shows a
    "⚠ changes how customers pay you" banner but takes the same explicit Apply. **Off-limits** —
    model/provider, all `*_secret_id`/keys/tokens, plan/billing/caps, account on/off, channel wiring,
    retention: these have **no tool and no allowlist entry**, so no prompt can reach them, and a
    hand-forged patch naming one is rejected by `validatePatch` (`.strict()` zod). Consistent with the
    standing rule to **never change a tenant's `llm_provider`/`llm_model` without asking** — there is
    deliberately no tool for it.
  - **Engine:** `services/ai/copilot/copilotTools.ts` is a side-effect-free tool registry over an
    in-memory `CopilotDraft` (mutable working snapshot so multiple tool calls in one turn compose);
    `runCopilotTurn.ts` builds the tier-rule system prompt + a compact snapshot of the editable profile
    only (no secrets), runs the bounded `provider.chat({ tools }, key)` loop, and logs one `usage_logs`
    row. `applyCopilotPatchAction` derives `catalog_data` via `parseCatalogueFreeform` and re-embeds via
    `ingestTenantKnowledge` in `after()` when the catalogue/KB changed.
  - **Holiday closure (no migration):** an optional `closures: [{from, to, message}]` (inclusive ISO
    dates) rides inside the existing `business_hours` JSONB. `services/hours.ts#computeOpenNow` checks
    an active closure first and returns `isOpen:false` + the closure message, which `aiOrchestrator.ts`
    surfaces in the open-now context line so the assistant tells customers "we're closed 24–26 Dec,
    back the 27th".
  - **Later:** Phase 2 reuses the same engine as a conversational onboarding intake for brand-new
    tenants (seeded onboarding prompt, kicks off with `import_from_url`, ends by marking
    `intake_completed_at`); Phase 3 adds proactive automation (owner daily digest, auto-KB suggestions,
    hard holiday-pause mode — see Track A).

## Track I — Inventory lite — ✅ SHIPPED (I1)

Approve/reject alone is NOT enough (damage happens before rejection; AI keeps selling sold-out
items). Scope: optional stock per catalogue item, prompt grounding, auto-decrement on confirmed
order, low-stock notification, one-tap restock. Explicitly NOT variants/warehouses.

- **Model (no migration):** stock rides INSIDE each `catalog_data` item as an optional numeric
  `stock` field. `services/inventory.ts` is the single **pure** interpreter (no `server-only`, so
  prompt builder + dashboard + order tool all share it): `readInventory`, `catalogHasStockTracking`,
  `setStockInCatalog` (case-insensitive exact-name; `null` clears tracking), `applyOrderDecrements`
  (aggregate per name, floor at 0, emit low/out `StockEvent`s). `LOW_STOCK_THRESHOLD = 3`.
- **Prompt grounding:** `promptBuilder.ts#buildInventoryRule` (a static `## STOCK` block) is spliced
  into `buildSystemPrefix` **only** when `catalogueMode === 'stuff' && catalogHasStockTracking(...)`,
  so untracked tenants get a byte-identical, cache-safe prefix. Teaches the model: `stock: 0` = sold
  out (refuse + offer an in-stock alternative), cap orders at available units, no `stock` field =
  untracked, never invent restock dates.
- **Auto-decrement:** `services/inventoryStore.ts#applyOrderStockEffects` (service-role, read-modify-
  write on the JSON — the race is accepted for "lite") fires at both confirmation points, best-effort:
  bypass-mode confirmed orders in `services/tools/createOrder.ts`, and pending→confirmed in
  `app/admin/orders/actions.ts#approveOrderAction` (so a rejected order never consumes stock). It also
  `notifyBoth` a `low_stock` alert when an item crosses low/out.
- **Dashboard:** new tenant-admin `/dashboard/inventory` route (`page.tsx` + `inventory-panel.tsx` +
  `inventory-actions.ts`, RLS-scoped writes via `createSupabaseServerClient`, same guard as intake).
  Per-item: set/track stock, one-tap **+10** restock (server-side read-modify-write), stop tracking.
  Nav entry (`Boxes` icon) sits in the tenant-admin management cluster past the mobile five-tab cap;
  the low-stock notification deep-links straight to it.
- **Parked migration** `0034_inventory_and_referrals.sql`: adds `low_stock` to
  `notifications_type_check`. Until applied, the low-stock notify silently no-ops (best-effort
  `notify()` swallows the constraint error) — **stock still decrements**; only the bell/email defers.

## Track G — Growth mechanics

- **G1 — plan-gated referral badge + attribution — ✅ SHIPPED.** The free-plan web widget's
  "Powered by CrewNest" footer is now plan-gated and doubles as a referral link; paid plans remove it.
  - **Config endpoint:** public `GET /api/widget/config?key=pk_live_…` (`app/api/widget/config/route.ts`)
    resolves the tenant via `resolveByWidgetKey` and returns `{ branding: boolean, referralUrl }`
    (`branding = plan !== 'free'` inverted; `referralUrl = ${APP_URL}/?ref=<slug|id>`). CORS echoes the
    origin (public, non-sensitive data only), 5-min cache, and **fails open to `branding: true`** on
    any unknown key/error so a free tenant is never silently un-branded and a transient failure never
    strips a paid tenant's removal unexpectedly.
  - **Widget:** `public/embed/widget.js` fetches the config on load; default (and fail-open) is the
    static badge text. Paid → badge hidden; free → badge becomes a referral `<a>` to `referralUrl`
    (href set via `setAttribute`, http(s)-only, `rel=noopener` — XSS-safe).
  - **Attribution capture:** `components/ref-capture.tsx` (mounted once in the root layout) reads
    `?ref=` off the landing URL, sanitises it, stores it in a first-party `cn_ref` cookie (30 d,
    SameSite=Lax) that survives the demo→signup funnel, and cleans the URL.
    `signup/provision-actions.ts` reads the cookie and records `referred_by` on the new tenant
    (best-effort; column ships with the parked `0034` migration, so it no-ops until applied — signup
    never breaks on attribution). **Capture-only — referral credits/rewards deferred.**
- Referral credits (give a month / get a month); annual pricing (2 months free). *(deferred)*
- Per-vertical `/try` templates (salon, boutique, bakery…) as SEO landing pages. *(deferred)*
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
