# CrewNest — Project Handoff & Remaining-Work Map (START HERE)

**Read this first.** It is the single entry point for the person now carrying CrewNest to completion.
It is self-contained on purpose: the prior developer's cross-session AI "memory" lives on their machine
and is **not** available to you — so this repo's docs are the only source of truth. After this file, read
`CLAUDE.md` + `AGENTS.md` (how-we-work rules) and `docs/` (architecture source of truth). Update this file
as you close items out.

> **First Claude session:** "Read `handoff.md`, then tell me the next unstarted item and start it." The
> ordered backlog in §4 is designed to be picked up top-down.

---

## 1. What CrewNest is

Multi-tenant SaaS: an "AI employee" for small businesses. A client's customers message on
WhatsApp / Messenger / Instagram / a website widget and get accurate, on-brand, catalogue-grounded
answers; the AI can also **take orders**, handle **custom-order media** (image/voice), and the owner
watches + takes over from a dashboard. Two dashboards: **agency/admin** (`/admin`, the operator running
many clients) and **client** (`/dashboard`, a single business owner). Both have a guard-railed **Copilot**
(a Claude-style chat that edits the business by proposing changes the owner one-tap applies).

- **Live:** `crewnest-rouge.vercel.app` (Vercel, GitHub continuous deploy — **pushing `main` = a
  production deploy**). Repo: `khubaibagha/crewnest`.
- **Stack:** Next.js 16 (App Router, Turbopack, RSC) · Supabase (Postgres + Auth + RLS + Vault + Storage)
  · Tailwind v4 · LLM via OpenAI **or** OpenRouter (per-tenant, BYOK or master key).
- **Backing services:** Supabase project (ref in `.env.local`/Vercel env) · Meta Graph API (channels) ·
  Resend (email, optional) · Sentry (errors, optional).

---

## 2. Run it + deploy

```bash
cd src/crewnest
cp .env.example .env.local     # then fill in real values (see §5 — some vars are MISSING from the example)
npm install
npm run dev                    # http://localhost:3000
npm run build                  # ALWAYS run before calling anything done — catches server/client boundary bugs tsc can't
node node_modules/typescript/bin/tsc --noEmit   # typecheck
```
Deploy = merge/push to `main` (Vercel auto-builds + promotes to prod). There is **no** staging branch —
so treat `main` as production and don't push untested work.

---

## 3. Current state — what's SHIPPED (do not rebuild)

Phases 1–3 are largely shipped. Phase 2 **billing** is code-complete but untested against a real
Stripe account (§4d); Phase 3 **Stage P** is done and deployed (§4e).

- **Phase 1 — Text omnichannel MVP:** ✅ Meta webhook (verify + signature + dedupe), Graph outbound,
  website widget, `aiOrchestrator`, prompt builder, Supabase Auth + RLS + Vault, admin dashboard, Live
  Inbox (realtime, take-over kill switch, manual send).
- **Phase 2 — Automation & self-serve:** ✅ tool-calling + **orders** (`create_order`, `/admin/orders`,
  order lifecycle + status messaging + reviews), ✅ **custom orders & media intake** (image/voice, approval
  queue), ✅ **client logins** (tenant_admin past the admin gate; `/dashboard`), ✅ **RAG** (pgvector
  knowledge base), ✅ **conversation summarisation**, ✅ **public self-serve signup** (`(auth)/signup/` →
  `provision-actions.ts`) + **free-plan caps** (daily session cap + monthly cost ceiling in
  `aiOrchestrator.ts`). ⚠️ **Billing (Stripe) — code-complete, DB applied, still untested** (§4d): schema
  is live; only a real Stripe account is needed before it can replace today's manual plan provisioning.
  ❓ **Embedded Meta OAuth signup** — verify; channel tokens may still be pasted manually via Vault.
- **Phase 3 — Harden/Prove (Stages P–V, docs 15–18):** ✅ Analytics (`0030`), ✅ data lifecycle / GDPR
  erasure (`0031`), ✅ hardening + rolling memory + free-plan ceiling + team management (`0032`),
  ✅ customer identity (`0033`), ✅ inventory + referrals (`0034`). ✅ **Stage P (reliability/durable
  queue delivery) — DONE** (§4e) — Meta webhook processing now goes through a pgmq queue + a deployed
  Supabase Edge Function worker instead of `after()`; Postgres-backed rate limiting; Meta 24h-window
  detection. Deployed and tested live against prod Supabase (see §4e for the residual gap).
- **Copilots:** ✅ **Business (owner) Copilot** — propose/apply profile edits + team/inventory **actions**
  (`invite_team_member`/`set_stock`/`restock`). ✅ **Admin Copilot** — read-only triage + two lookup tools,
  **plus the same three write actions** (invite/set_stock/restock) targeting a named client, propose/apply
  gated (§4a Item 2 — done). ✅ **Admin System Health** (`/admin/health`, docs/20).
- **Notifications:** ✅ in-app (`notifications` table + dashboard bell) + ✅ email via **Resend**
  (`services/email.ts`) — domain verified (`mail.kraftnest.co`), API key live locally, real send confirmed;
  Vercel env still pending (§4c). ❌ **Web push — NOT built** (§4c).
- **UI polish (recent):** logo/wordmark font (Baloo 2), topbar headings, inbox layout, hero anti-jank.

Migrations live in `supabase/migrations/` (`0001`–`0038` today). **All applied** to the live project
as of 2026-07-2x (`0008`, `0035`–`0038` confirmed via direct verification, not assumed). They are
applied **manually** in the Supabase SQL editor — see the drift warning in §5.

---

## 4. Remaining work — ORDERED backlog

Do these top-down. Each says **what**, **where the spec is**, **which model** (this repo follows an
Opus-designs / Sonnet-builds split — `[OPUS]` work is high-stakes/novel design), and **status**.

### 4a. Copilot follow-ups + Admin-Copilot actions + signup/caps audit — **2 of 3 DONE, item 1 on hold**
- **Spec:** [`HANDOFF-followups-admin.md`](HANDOFF-followups-admin.md) (self-contained, Opus-authored).
- **Model:** Sonnet (design already done).
- Three items: (1) **scheduled customer follow-up messages** — AI proactively re-messages a customer, with
  a hybrid delivery (auto-send when inside Meta's 24h window, else owner-alert), triggered by **Supabase
  pg_cron + pg_net** (the project is on Vercel free/Hobby, so Vercel cron can't run sub-daily) — **not
  started, on hold** (discussed with the user 2026-07-26: real value but non-urgent, and hard to validate
  meaningfully until Meta channels are actually live — see §4b); (2) **admin-copilot write actions**
  mirroring the owner's 3 — **done**, see below; (3) **audit** the shipped signup + caps — **done**, see
  below.
- Item 1 produces new migrations `0035` (table + notifications type) and `0036` (pg_cron SQL, run
  manually) — neither exists yet.
- **Item 2 — complete.** Admin Copilot (`/admin/copilot`) can now propose `invite_team_member`/
  `set_stock`/`restock` on a **named client** (previously read-only-only: two lookup tools, zero writes).
  Added a business-name resolver (`resolveTenantByName` in `adminCopilotTools.ts` — zero/multiple matches
  both refuse rather than guess) and three staging tools reusing the Business Copilot's exact
  `CopilotAction` schema. `adminCopilotTurnAction` now returns an optional staged action;
  `applyAdminCopilotActionAction` (new, in `admin/copilot-actions.ts`) is the sole writer — re-checks
  `isPlatformAdmin`, re-validates against the `.strict()` allowlist, dispatches to the same
  `inviteMember`/`setItemStockAction`/`restockItemAction` the owner side uses. UI reuses
  `ProposedActionCard` (now exported from `business-copilot.tsx`) with a "For {business}" label. No new
  action types; billing/plan/model/secrets/customer-messaging remain untouchable, same as the owner side.
  Doc updated: `docs/20-ADMIN-SYSTEM-HEALTH-AND-COPILOT.md` §2.6 (v3 addendum) — its earlier
  `[OPUS]-FROZEN` "no write tools, ever" language is explicitly superseded there, not silently
  contradicted.
  - **Real bug found + fixed during testing:** the model initially refused to act on a real client
    because it wasn't listed in the "needs attention" snapshot (a partial, filtered view) — it read
    "absent from snapshot" as "doesn't exist," even when told exactly which tool to call. Fixed by making
    the system prompt state plainly that the snapshot is partial and the lookup/write tools search the
    full client list regardless.
  - **Verified live** via a real authenticated browser session (Playwright, installed locally via
    `--no-save`, not a project dependency) against a test tenant: staged a `set_stock` action → Apply →
    confirmed the `catalog_data` write actually landed in Supabase; staged a `restock` correctly as an
    addition; an unknown business name was refused in plain text with no card; an off-limits ask ("pause
    the account", "switch to GPT-4") was refused and pointed to the client page. `tsc --noEmit` and
    `npm run build` both green.
- **Item 3 audit — complete.** Traced signup (`provisionTenantAction`), the daily session cap, and the
  monthly cost cap end-to-end; no code changes needed for the trace itself, but it surfaced two real gaps,
  both now fixed and locally verified against a live tenant + real OpenRouter turns (not yet committed —
  see below):
  - **Rolling 30-day cap reset.** Previously a free tenant that hit `plan_status='cap_reached'` had no way
    back except a manual DB edit — no admin UI control, no scheduled rollover job existed. Changed the
    monthly-spend check from calendar-month-to-date to a rolling 30-day window
    (`messages.getTrailing30DayMasterCostUsd`, renamed from `getMonthToDateMasterCostUsd`) and added an
    auto-clear: once windowed spend drops back under cap, `aiOrchestrator.ts` flips `plan_status` back to
    `null` on the next turn — no cron job or admin button needed. Verified live: tripped the cap on a real
    tenant, confirmed `plan_status='cap_reached'` + exactly one owner+agency notification (no spam on
    repeat blocked turns), then aged out `usage_logs` past 30 days and confirmed a fresh session got a
    normal AI reply again with `plan_status` back to `null`.
  - **Signup double-submit guard.** `complete-client.tsx`'s `useEffect` called `provisionTenantAction`
    with no re-entrancy guard — React Strict Mode's double-invoke (or any remount) could fire it twice
    before the first call's `ctx.memberships.length > 0` check would catch it, risking two tenants linked
    to one user. Added a `useRef` guard so only the first effect run calls the action. Verified via a real
    signup: exactly one `tenants` row + one `user_tenants` row for the new user.
  - Docs note: `docs/18-HARDENING-AND-TEAM.md` §3 still describes the cap as "month-to-date" — left
    as-is (frozen Opus design doc), but the shipped behavior is now the rolling-30-day version above.
  - Not changed (flagged, not fixed): the double-submit race is still theoretically possible at the
    database level if two calls land within the same read-check window — the `useRef` guard closes the
    practical client-triggered case (Strict Mode, remounts) but isn't a DB-level constraint. Revisit if a
    real double-tenant ever shows up in prod.

### 4b. Provision env + integrations so it actually runs in prod — **OPS, do early**
Nothing below works in production until the environment is wired. See §5 for the full checklist. This is
mostly non-code: Vercel env vars, Supabase migrations actually applied, `CRON_SECRET`, Meta app/tokens,
Resend domain. **Do 4b before QA (4g)** — most "bugs" at this stage are missing env.

### 4c. Resend + push notifications
- **Resend — domain verified, working locally, Vercel pending.** Code was already done; ops half is now
  mostly done too: `mail.kraftnest.co` (a subdomain — chosen deliberately to avoid colliding with the
  existing Zoho MX/SPF/DKIM records already on the root `kraftnest.co` domain) is verified in Resend, DNS
  records added via Netlify DNS (the domain's actual DNS host — `kraftnest.co` uses custom nameservers
  pointing at Netlify, not Spaceship's own DNS panel, despite being registered at Spaceship). Real
  `RESEND_API_KEY` + `RESEND_FROM_EMAIL=notifications@mail.kraftnest.co` are set in `.env.local`; a real
  send through the actual `services/email.ts` `sendEmail` function was confirmed delivered. **Still
  needed:** the same two vars in **Vercel's** env — blocked on the Vercel access situation (see §4b note
  below), not on Resend itself.
- **Web push — NET-NEW build** (nothing exists): VAPID keys, a service worker in `public/`, a
  `push_subscriptions` table, a subscribe UI in the dashboard, and send-on-notify wiring into
  `services/notifications.ts` (which already fans out in-app + email — push becomes a third sink).
  **Model: `[OPUS]` design pass first** (permission UX, subscription lifecycle, which events push). Ref:
  docs/14 (Command Center & Notifications).

### 4d. Payment setup (SaaS billing) — **BUILT, needs a real Stripe account to test**
- **Spec:** [`docs/22-BILLING-STRIPE.md`](docs/22-BILLING-STRIPE.md) (Opus design pass + build,
  2026-07-27). Provider decided **with the user**: Stripe — tenant base is global/mixed and neither
  Stripe nor a local PK gateway had an existing account, so Stripe's international reach won.
- **What shipped:** flat-fee subscriptions on the existing free/$29 starter/$79 pro tiers (NOT metered
  usage-based billing — a deliberate re-scope from doc-07's original sketch, see docs/22 §2.1). Hosted
  Stripe Checkout + Customer Portal only, zero custom card UI. The Stripe webhook
  (`api/webhooks/stripe/route.ts`) is the SOLE writer of `tenants.plan`/`plan_status` once live —
  idempotent via a new `stripe_events` ledger, same pattern as `webhook_events`. Paid-plan signup now
  redirects straight to real Checkout instead of the old "we'll email you" holding message. The
  paid-tier "soft overage" signal this doc originally called for turned out to already exist
  (`services/maintenance.ts`'s `daily_cost_alert_usd` cron, docs/17 §3) — reused, not rebuilt.
- **Migration `0038_billing.sql`** — `tenants.stripe_customer_id`/`stripe_subscription_id`, the FIRST
  real DB check constraint on `plan_status` (adds `'payment_failed'`), `stripe_events` ledger. **Applied
  and verified** (columns/table existence + a constraint-rejection test, 2026-07-2x).
- **Verified:** `tsc`/`eslint`/`vitest`/`npm run build` all green; grepped both Copilot tool registries
  to confirm `plan`/`plan_status`/the two new Stripe columns remain unreachable by any Copilot — still
  true, unchanged.
- **NOT verified — needs a real Stripe account:** actual checkout completion, real webhook delivery,
  portal access. None of that could be tested without Stripe credentials, which don't exist yet.
- **Still needed from you:** create a Stripe account (test mode is enough to start), create the
  Starter ($29/mo) and Pro ($79/mo) Products/Prices to match `PAYWALL_PLANS`, get
  `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`STRIPE_PRICE_STARTER`/`STRIPE_PRICE_PRO`, register the
  webhook endpoint (`/api/webhooks/stripe`) in the Stripe dashboard. Per the Vercel marketplace note
  below, prefer a real provisioned Stripe integration over hand-rolled keys if that path is available.
- **Don't confuse with customer payments:** taking a *customer's* money for an order (bank transfer +
  payment-proof upload) is already built and untouched. 4d is about charging *tenants* for CrewNest itself.

### 4e. Stage P completion — reliability & durable delivery — **DONE, deployed, tested live**
- **Spec:** [`docs/15-RELIABILITY-AND-DURABILITY.md`](docs/15-RELIABILITY-AND-DURABILITY.md) (all `[OPUS]`
  gates were already CLEARED per docs/07 Phase 3; built and shipped 2026-07-2x).
- **P1 — pgmq enabled**, with a real wrinkle: this project's Supabase dashboard has **no dedicated Queues
  integration page** (confirmed — nothing under Database in the sidebar), so the usual "toggle Queues →
  auto-creates a `pgmq_public` wrapper schema" path doesn't exist here. Migration `0008_pgmq.sql` (extension
  + `inbound_messages` queue) is applied. A **new** migration `0036_pgmq_public_wrapper.sql` hand-builds the
  `pgmq_public` wrapper (`send`/`read`/`archive`, verified against the actual installed pgmq 1.5.1 function
  signatures via direct DB introspection, not assumed from docs) — this is the documented community
  workaround for hosted projects missing that dashboard feature. `pgmq_public` was then added to **Project
  Settings → Data API → Exposed schemas** (had to be done AFTER the wrapper schema existed — it doesn't
  appear as a selectable option before that).
- **P2 — producer.** `api/webhooks/meta/route.ts` rewritten: verify → parse → per-message
  enqueue-with-dedup (the `webhook_events` insert IS the dedup gate, `23505` = skip) → 200. Zero LLM work in
  the request path. New `services/queue.ts` wraps the `pgmq_public` RPC surface.
- **P3 — worker, deployed.** `supabase/functions/inbound-worker/index.ts` (Deno, Supabase Edge Function —
  a genuinely separate runtime from Next.js/Node, so it can't import `aiOrchestrator.ts` directly). It owns
  the pgmq read + §3.2 processing-idempotency state machine + §4 poison handling (5 attempts →
  `status='dead'` + agency `system_alert`, then archived), and delegates the actual AI turn over HTTP to a
  **new** internal bridge route, `api/internal/process-message` (CRON_SECRET-gated, same pattern as
  `api/cron/maintenance`), which calls the **unchanged** `handleInboundMessage`. Deployed via
  `npx supabase functions deploy inbound-worker --no-verify-jwt` (the `--no-verify-jwt` flag was required —
  Supabase's platform-level JWT gateway check runs before function code and rejects a custom bearer secret
  by default; this function is called by a cron job, not a logged-in user, so the built-in check is
  correctly disabled and the function does its own `INBOUND_WORKER_SECRET` check instead). Edge Function
  secrets (`APP_URL`, `CRON_SECRET`, `INBOUND_WORKER_SECRET`) set via `npx supabase secrets set` —
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are auto-injected by the platform, don't set those manually.
- **P4 — durable rate limiting, done.** `rateLimit.ts` now has a Postgres-backed atomic-increment path
  (`increment_rate_limit_bucket`, new in migration `0035`, `insert ... on conflict do update set count =
  count + 1 returning count` — a plain PostgREST upsert can't express "increment on conflict") for
  production, selected by `NODE_ENV`; the old in-memory Map stays for local dev so `npm run dev` pays no DB
  round-trip. Fails open (never blocks real traffic) on any DB error, logged.
- **P5 — Meta 24h-window handling, done.** `services/meta/send.ts` now detects Meta's outside-window error
  codes (`131047`/`#10`, checked by code not message-string) and throws a distinguishable `MetaWindowError`.
  `aiOrchestrator.ts`'s dispatch step catches it specifically for `continueSession` turns (`userText ===
  null`): the already-persisted reply is marked `chat_messages.delivery_failed` (reuses migration `0022`'s
  column — the inbox already renders "Not delivered" with zero UI changes), `chat_sessions
  .delivery_blocked_reason='meta_window'` is set, and the tenant gets a notification instead of the send
  error being thrown into the void.
- **Verified live against the real prod Supabase project** (not just typecheck/build): sent an identical
  Meta webhook payload twice → exactly one `webhook_events` row + exactly one queued pgmq message (proves
  the dedup gate); 10 concurrent rate-limit increments on the same bucket returned exactly `1..10` with no
  races (proves true atomicity, the whole point of P4); the deployed worker was called for real, claimed a
  queued message, correctly hit its no-matching-ledger-row fail-safe branch, and archived it cleanly.
- **Residual gap, not yet tested:** the worker's *happy path* — a message that has a matching
  `webhook_events` row and successfully reaches `handleInboundMessage` via the internal bridge route — has
  not been exercised, because the Edge Function's `APP_URL` secret currently points at `localhost:3000`,
  which Supabase's cloud can't reach. This needs a real, publicly reachable deployment URL, which is
  blocked on the Vercel access situation (see §4b / the note at the top of this file's history — the
  existing Vercel project is under a partner's account and Hobby plan can't add collaborators). Once
  Vercel access is resolved, re-run `npx supabase secrets set APP_URL=<real-url>` and re-test end to end
  with a real Meta message.

### 4f. Phase 4 — Voice & Platform — **`[OPUS]` design first; large, net-new**
- **Spec seed:** [`docs/07-PHASES.md`](docs/07-PHASES.md) §Phase 4. **No spec doc exists yet** — this needs
  its own Opus design pass before any build.
- **Scope:** **Voice AI** (SIP-trunk transcripts → orchestrator → TTS; `platform='voice'`, the
  `webhooks/voice` 501 stub is the seam) — net-new capability (STT/TTS provider, realtime turn-taking,
  latency budget, handoff interplay). Plus template/persona marketplace, multi-agent "crew" workflows,
  deeper CRM/helpdesk integrations, white-label, granular team roles, audit-log UI.
- **Reality check:** this is the biggest, least-defined chunk. Treat "Phase 4 completion" as a program of
  several designed sub-features, not one task. Do 4a–4e first.

### 4g. QA / acceptance testing
- **Automated:** `vitest` unit + RLS-isolation tests + GitHub Actions CI (typecheck/lint/test/secret-scan/
  migration-lint) — designed in docs/17; confirm they run and extend coverage for 4a–4e.
- **Manual acceptance:** the checklists in [`docs/07-PHASES.md`](docs/07-PHASES.md) (Phase 1/2 criteria)
  and each doc's §Acceptance — e.g. real Meta message e2e, two-tenant RLS isolation, widget origin
  allow/deny, take-over mutes AI, signup→free-tenant→hit caps→notify. **Run these against a real
  configured environment (4b), ideally on a preview deploy, not by creating junk in prod.**

---

## 4.1 When to switch to Opus (design-first items) 🧠

This repo follows an **Opus-designs / Sonnet-builds** split. Before you start a backlog item, check it
against this list and **switch models accordingly** — start the session on the right model rather than
discovering mid-build that a decision needs deeper reasoning. Rule of thumb: **if there's no spec doc
yet, or the item changes a locked interface / money / auth / a novel external integration, it's an
`[OPUS]` planning pass first**; if a spec already exists and the hard calls are made, it's Sonnet build.

**Needs an Opus planning pass BEFORE any build:**

| Item | Why Opus | What Opus must decide first |
|---|---|---|
| **4c — Web push** (net-new) | Novel client/runtime surface, no spec | Permission-prompt UX, subscription lifecycle (subscribe/renew/revoke), `push_subscriptions` schema, **which** events push vs. stay in-app/email, service-worker + VAPID approach. |
| **4d — Payment / SaaS billing** | Money + irreversible external integration; **no code exists** | **Provider decision first** (Stripe subscriptions+metering vs. a local PK gateway like JazzCash/EasyPaisa — ask the owner). Then subscription vs. usage-metering model, webhook/idempotency, how `plan`/`plan_status` flip (still off-limits to Copilots). |
| **4f — Phase 4 Voice AI + platform** | Biggest, least-defined; **no spec doc** | Its own design doc: STT/TTS provider, realtime turn-taking, latency budget, handoff interplay for `platform='voice'`. Also the marketplace / multi-agent "crew" / white-label sub-features — treat each as a designed unit, not one task. |
| **Any change to a locked interface** | High blast radius | The forecast/schema/tool "locked" surfaces and RLS/Vault grants — any edit here is an Opus checkpoint (see §6 + docs `[OPUS]` markers). Off-limits Copilot fields (`llm_provider`, `llm_model`, `*_secret_id`, `plan`, `plan_status`, `free_monthly_cap_usd`, `daily_cost_alert_usd`, `is_active`, `message_retention_days`, channel ids, `slug`, billing) must stay tool-less and hard-rejected — never add a path to them without an Opus review. |

**Already designed — Sonnet can build straight away (no Opus pass needed):**
- **4a — Follow-ups + admin-copilot actions + audit:** fully specced in
  [`HANDOFF-followups-admin.md`](HANDOFF-followups-admin.md) (Opus-authored). Build with Sonnet.
- **4e — Stage P reliability/queue:** all `[OPUS]` gates **CLEARED** per docs/07 Phase 3; build against
  [`docs/15-RELIABILITY-AND-DURABILITY.md`](docs/15-RELIABILITY-AND-DURABILITY.md) with Sonnet.
- **4b / 4g / Resend + domain (part of 4c):** ops + mechanical — no design pass, Sonnet or by hand.

> Even inside a Sonnet build, if you hit a fork the spec didn't anticipate (a new schema shape, a
> security/auth trade-off, a locked-interface edit), **stop and switch to Opus for that decision**, then
> hand the resolved design back to Sonnet.

---

## 5. Manual / ops integration checklist (make it fully functional)

The prior owner must privately hand you the **secret values** (never in git/this doc) — you set them in
`.env.local` (local) **and** the Vercel project (prod). Ask them for:

| Secret / setting | Where used | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase client | Public (anon), safe in browser. |
| `SUPABASE_SERVICE_ROLE_KEY` | server writes / worker | **Server-only, bypasses RLS.** Never expose. |
| `MASTER_OPENAI_KEY` | LLM master fallback (OpenAI tenants) | Was a placeholder historically — confirm it's real. |
| `MASTER_OPENROUTER_KEY` | LLM master fallback (OpenRouter tenants) | The live demo runs on OpenRouter; `.env.example` has the placeholder — just fill the real value. |
| `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_GRAPH_VERSION` | Meta webhook + Graph send | Verify token is one *you* choose (must match Meta config); app secret from Meta App → Settings → Basic. |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | email notifications | ✅ Real values set in `.env.local` (domain `mail.kraftnest.co` verified, real send confirmed). Still need to land in **Vercel** env. |
| `CRON_SECRET` | `/api/cron/maintenance`, `api/internal/process-message` (the §4e worker bridge), and future `/api/cron/follow-ups` | Set in Vercel env, **and** as an Edge Function secret (`npx supabase secrets set CRON_SECRET=...`) — must be the SAME value in both places. Mirror into **Supabase Vault** too if/when the pg_cron job (4a) is built. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | web push (docs/21) | ✅ Real keypair generated + set in `.env.local`, migration `0037` applied, verified against a real push service (410 pruning confirmed). Ready for manual browser testing. Still needs to land in **Vercel** env for prod. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO` | billing (docs/22) | ⚠️ **No Stripe account exists yet** — none of these have real values. DB schema (`0038`) is applied and ready. Unlike Resend/push, billing has no safe "unconfigured" no-op mode; the checkout/portal actions will refuse with a clear error until these are real. |
| `SENTRY_DSN` | error tracking (optional) | No-op until set. |
| `NEXT_PUBLIC_APP_URL` | absolute links | Set to the prod URL in Vercel. |

**Other manual steps to reach "fully functional":**
1. **Supabase migrations actually applied.** Migrations are run **by hand** in the Supabase SQL editor —
   there is **no auto-apply**, so drift is a real risk. Every migration through `0036` is applied in the
   live project as of 2026-07-2x (verified directly, not assumed — `0008_pgmq` needed the extension
   enabled via Database → Extensions AND the queue actually created via its `perform pgmq.create(...)`
   block; `0036` hand-builds `pgmq_public` since this project has no dashboard Queues integration to
   auto-generate one — see §4e). **`0037` (push_subscriptions) and `0038` (billing) are also applied**
   (verified 2026-07-2x: table/column existence checks + a constraint-rejection test all passed). When
   a task hands you new SQL, run it and confirm.
2. **Vercel env vars:** set every server var above in the Vercel project (Production + Preview). A missing
   var usually presents as a silent feature no-op, not a crash. **Currently blocked**: the existing Vercel
   project is under a partner's account, not accessible from this session/machine, and Vercel Hobby can't
   add collaborators — needs a project transfer or the partner relaying the work (undecided as of
   2026-07-2x).
3. **Edge Function worker secrets** (for §4e's pgmq worker, `supabase/functions/inbound-worker`): set via
   `npx supabase secrets set APP_URL=<prod-url> CRON_SECRET=<value> INBOUND_WORKER_SECRET=<value>`
   (`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are auto-injected, don't set those). Deploy with
   `npx supabase functions deploy inbound-worker --no-verify-jwt` — the `--no-verify-jwt` flag is required
   (Supabase's platform JWT gateway otherwise 401s every call before the function's own auth check ever
   runs). `APP_URL` currently points at `localhost:3000` as a placeholder — **must be updated to the real
   prod URL** once Vercel access is resolved, or the worker can never reach `api/internal/process-message`
   to actually run the AI turn.
4. **pg_cron + pg_net** (for 4a follow-ups, if revived): enable the extensions, store `CRON_SECRET` in
   Supabase Vault, run item 1's own cron SQL (not yet written) with the real prod domain filled in. Confirm
   prod isn't behind Vercel Deployment Protection (would block the automated ping — public by default on
   Hobby).
5. **Meta channels go-live:** for real customer traffic you need the Meta App out of Development mode →
   **Meta App Review** (permissions: messaging scopes) + a public HTTPS webhook (prod URL, not localhost).
   Testing with your own accounts works in Development mode without review — see the IG/Meta checklist in §7.
   WhatsApp business-initiated messages (owner notifies, out-of-window follow-ups) need **approved message
   templates** — an ops step, not code.
6. **Resend domain verification** — ✅ **done** (`mail.kraftnest.co`, see §4c) — before email is useful to
   real recipients. Vercel env still pending, same blocker as item 2 above.
7. **Custom domain** (optional): point a real domain at the Vercel project; update `NEXT_PUBLIC_APP_URL`
   and Meta webhook/redirect URLs + Supabase Auth redirect allow-list accordingly.

---

## 6. Working rules (read `CLAUDE.md` + `AGENTS.md` for the full set)

- **Opus designs, Sonnet builds.** Anything touching locked interfaces or novel/high-stakes reasoning is
  an `[OPUS]` checkpoint — switch to Opus for it; use Sonnet for mechanical implementation.
- **Migrations are manual + idempotent** (`create ... if not exists`, `drop constraint if exists`). After
  writing one, **hand the exact SQL to the owner/operator to paste** — nothing auto-applies.
- **Run the full `npm run build`**, not just `tsc` — a `server-only` module pulled into a client bundle
  only fails in the build (this has bitten the project before).
- **`'use server'` files export async functions only** — a non-async export there crashes at runtime.
- **Never** change a tenant's `llm_provider`/`llm_model`, or let any Copilot touch off-limits fields
  (`plan`, `plan_status`, `*_secret_id`, `is_active`, billing, channel ids) — no tool exists for them and
  the appliers hard-reject them. Keep it that way.
- **Push to `main` = prod.** Commit freely; **push only when the owner confirms**.
- **Never print or commit secret values.** Reference them by variable name; they live only in gitignored
  `.env.local` + Vercel env + Supabase Vault.

---

## 7. Ops gotchas & Meta live-connection checklist (timeless — keep)

**Gotchas that will waste your time if you don't know them:**
- **Env is cached at module load.** After editing `.env.local`, **restart the dev server** or changes are
  ignored. (Find the PID on port 3000, kill it, `npm run dev` again.)
- **Scratch DB scripts must live inside `src/crewnest/`**, not the OS temp dir — Node resolves
  `node_modules` relative to the importing file, so a temp-dir script can't find `@supabase/supabase-js`.
  Run once, delete immediately; never commit them.
- **`Glob`/ripgrep can time out** on broad `src/crewnest/**` patterns — fall back to listing a specific
  directory.
- **Manual-migration drift** (above) — the #1 source of "works locally, broken in prod."
- **Widget sessions persist their key in `localStorage`** — clear it between manual tests or a muted
  (handed-off) session stays muted on reload.

**Connect a real Instagram/Messenger channel for live testing (Development mode, no App Review):**
1. IG account must be **Business/Creator**, linked to a Facebook Page (hard Meta requirement).
2. Create a Meta App (developers.facebook.com); add Instagram + Messenger products; keep it in
   **Development mode**.
3. Generate a **Page Access Token** (Graph API Explorer) with `instagram_basic`,
   `instagram_manage_messages`, `pages_messaging` for that Page.
4. Expose localhost over HTTPS (`ngrok http 3000` / cloudflared) — Meta can't reach `localhost`.
5. Register the webhook in the Meta App: callback `https://<tunnel>/api/webhooks/meta`, verify token =
   your `META_VERIFY_TOKEN`; subscribe the `messages` field.
6. Put the **real** `META_APP_SECRET` in `.env.local` (a wrong value silently 401s every message via the
   `X-Hub-Signature-256` check). **Restart the dev server.**
7. In the dashboard, set the tenant's **Instagram business account id** (numeric, via
   `GET /{page-id}?fields=instagram_business_account` — not the @handle) and **Meta page token**.
8. DM the account from a personal account added as a **Tester/Admin** on the app; watch webhook → signature
   → dedupe → `after()` → `aiOrchestrator` → reply.

---

*Last rewritten as the co-founder handoff (project ownership transfer). Supersedes the old single-session
snapshot. Keep §3 (shipped) and §4 (backlog) current as items close.*
