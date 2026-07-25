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

Phases 1–3 are largely shipped; Phase 2 **billing** and Phase 3 **Stage P** are the notable gaps (§4).

- **Phase 1 — Text omnichannel MVP:** ✅ Meta webhook (verify + signature + dedupe), Graph outbound,
  website widget, `aiOrchestrator`, prompt builder, Supabase Auth + RLS + Vault, admin dashboard, Live
  Inbox (realtime, take-over kill switch, manual send).
- **Phase 2 — Automation & self-serve:** ✅ tool-calling + **orders** (`create_order`, `/admin/orders`,
  order lifecycle + status messaging + reviews), ✅ **custom orders & media intake** (image/voice, approval
  queue), ✅ **client logins** (tenant_admin past the admin gate; `/dashboard`), ✅ **RAG** (pgvector
  knowledge base), ✅ **conversation summarisation**, ✅ **public self-serve signup** (`(auth)/signup/` →
  `provision-actions.ts`) + **free-plan caps** (daily session cap + monthly cost ceiling in
  `aiOrchestrator.ts`). ❌ **Billing (Stripe) — NOT built** (paid plans provisioned manually today).
  ❓ **Embedded Meta OAuth signup** — verify; channel tokens may still be pasted manually via Vault.
- **Phase 3 — Harden/Prove (Stages P–V, docs 15–18):** ✅ Analytics (`0030`), ✅ data lifecycle / GDPR
  erasure (`0031`), ✅ hardening + rolling memory + free-plan ceiling + team management (`0032`),
  ✅ customer identity (`0033`), ✅ inventory + referrals (`0034`). ⚠️ **Stage P (reliability/durable
  queue delivery) — only scaffolded** (`0029_reliability.sql` added `webhook_events` status +
  `rate_limit_buckets`), the actual `after()`→queue+worker cutover is **deferred** (§4e).
- **Copilots:** ✅ **Business (owner) Copilot** — propose/apply profile edits + team/inventory **actions**
  (`invite_team_member`/`set_stock`/`restock`). ✅ **Admin Copilot** — read-only triage + two lookup tools
  (adding write actions is §4a). ✅ **Admin System Health** (`/admin/health`, docs/20).
- **Notifications:** ✅ in-app (`notifications` table + dashboard bell) + ✅ email via **Resend**
  (`services/email.ts`, best-effort). ❌ **Web push — NOT built** (§4c).
- **UI polish (recent):** logo/wordmark font (Baloo 2), topbar headings, inbox layout, hero anti-jank.

Migrations live in `supabase/migrations/` (`0001`–`0034` today). They are applied **manually** in the
Supabase SQL editor — see the drift warning in §5.

---

## 4. Remaining work — ORDERED backlog

Do these top-down. Each says **what**, **where the spec is**, **which model** (this repo follows an
Opus-designs / Sonnet-builds split — `[OPUS]` work is high-stakes/novel design), and **status**.

### 4a. Copilot follow-ups + Admin-Copilot actions + signup/caps audit — **IN PROGRESS**
- **Spec:** [`HANDOFF-followups-admin.md`](HANDOFF-followups-admin.md) (self-contained, Opus-authored).
- **Model:** Sonnet (design already done).
- Three items: (1) **scheduled customer follow-up messages** — AI proactively re-messages a customer, with
  a hybrid delivery (auto-send when inside Meta's 24h window, else owner-alert), triggered by **Supabase
  pg_cron + pg_net** (the project is on Vercel free/Hobby, so Vercel cron can't run sub-daily) — **not
  started**; (2) **admin-copilot write actions** mirroring the owner's 3 — **not started**; (3) **audit**
  the shipped signup + caps — **done**, see below.
- Item 1 produces new migrations `0035` (table + notifications type) and `0036` (pg_cron SQL, run
  manually) — neither exists yet.
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
- **Resend:** code is done. Ops-only: create a Resend account, **verify a sending domain** (until then it
  only mails the account owner via `onboarding@resend.dev`), set `RESEND_API_KEY` + `RESEND_FROM_EMAIL`
  (locally and in Vercel — both are now placeholders in `.env.example`). Ref: docs/14 §3.4.
- **Web push — NET-NEW build** (nothing exists): VAPID keys, a service worker in `public/`, a
  `push_subscriptions` table, a subscribe UI in the dashboard, and send-on-notify wiring into
  `services/notifications.ts` (which already fans out in-app + email — push becomes a third sink).
  **Model: `[OPUS]` design pass first** (permission UX, subscription lifecycle, which events push). Ref:
  docs/14 (Command Center & Notifications).

### 4d. Payment setup (SaaS billing) — **`[OPUS]` design first, then decision**
- **State:** **no Stripe / no billing code anywhere.** Paid plans (`starter`/`pro`) are provisioned
  manually; the free plan is capped in-app. To monetise self-serve you need a real billing layer.
- **Decision needed (ask the owner):** payment provider — **Stripe** (subscriptions + usage metering off
  `usage_logs`, the doc-07 Phase-2 plan) vs a **local PK gateway** (JazzCash/EasyPaisa) if the customer
  base is Pakistan-first. This changes everything downstream, so decide before building.
- **Reuse:** the plan model already exists (`tenants.plan`, `plan_status`, `free_monthly_cap_usd`, the
  `paywall-modal`, `upgrade_request` notifications). Billing wires *payment* onto that spine — do **not**
  let any Copilot touch `plan`/`plan_status`/billing fields (they're off-limits by design).
- **Note (Vercel):** when adding an external service, the environment has a `marketplace` skill / Vercel
  marketplace integration path for provisioning Stripe — prefer a real provisioned integration over
  hand-rolled keys. Ref: docs/07 Phase 2 "Billing", docs/11 (payments/order lifecycle, customer side).
- **Don't confuse with customer payments:** taking a *customer's* money for an order (bank transfer +
  payment-proof upload) is already built. 4d is about charging *tenants* for CrewNest itself.

### 4e. Stage P completion — reliability & durable delivery — **Sonnet (design cleared)**
- **Spec:** [`docs/15-RELIABILITY-AND-DURABILITY.md`](docs/15-RELIABILITY-AND-DURABILITY.md) (all `[OPUS]`
  gates already CLEARED per docs/07 Phase 3).
- **What's left:** enable **pgmq** (migration `0008` referenced in the doc), move Meta webhook processing
  from `after()` to a **queue + worker** (at-least-once, poison-safe, two-source idempotency), wire
  **Postgres-backed rate limiting** (the `rate_limit_buckets` table from `0029` exists but confirm it's
  used), and **Meta 24h-window** handling. The orchestrator is trigger-agnostic on purpose, so this is a
  delivery-layer change, not an AI change.

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
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | email notifications | Placeholders now in `.env.example`; fill real values. Needs a verified domain in Resend. |
| `CRON_SECRET` | `/api/cron/maintenance` **and** `/api/cron/follow-ups` | Set in Vercel env **and** mirror the same value into **Supabase Vault** for the pg_cron job (4a). |
| `SENTRY_DSN` | error tracking (optional) | No-op until set. |
| `NEXT_PUBLIC_APP_URL` | absolute links | Set to the prod URL in Vercel. |

**Other manual steps to reach "fully functional":**
1. **Supabase migrations actually applied.** Migrations are run **by hand** in the Supabase SQL editor —
   there is **no auto-apply**, so drift is a real risk. Verify every migration through `0034` (and the new
   `0035`/`0036`) is applied in the live project. When a task hands you SQL, run it and confirm.
2. **Vercel env vars:** set every server var above in the Vercel project (Production + Preview). A missing
   var usually presents as a silent feature no-op, not a crash.
3. **pg_cron + pg_net** (for 4a follow-ups): enable the extensions, store `CRON_SECRET` in Supabase Vault,
   run the `0036` cron SQL with the real prod domain filled in. Confirm prod isn't behind Vercel
   Deployment Protection (would block the automated ping — public by default on Hobby).
4. **Meta channels go-live:** for real customer traffic you need the Meta App out of Development mode →
   **Meta App Review** (permissions: messaging scopes) + a public HTTPS webhook (prod URL, not localhost).
   Testing with your own accounts works in Development mode without review — see the IG/Meta checklist in §7.
   WhatsApp business-initiated messages (owner notifies, out-of-window follow-ups) need **approved message
   templates** — an ops step, not code.
5. **Resend domain verification** (4c) before email is useful to real recipients.
6. **Custom domain** (optional): point a real domain at the Vercel project; update `NEXT_PUBLIC_APP_URL`
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
