# ClerkNest — Project Handoff & Remaining-Work Map (START HERE)

**Read this first.** It is the single entry point for the person now carrying ClerkNest to completion.
It is self-contained on purpose: the prior developer's cross-session AI "memory" lives on their machine
and is **not** available to you — so this repo's docs are the only source of truth. After this file, read
`CLAUDE.md` + `AGENTS.md` (how-we-work rules) and `docs/` (architecture source of truth). Update this file
as you close items out.

> **First Claude session:** "Read `handoff.md`, then tell me the next unstarted item and start it." The
> ordered backlog in §4 is designed to be picked up top-down. **Exception right now: there is an ACTIVE,
> mid-stream piece of work — see §0 below — pick that up first, before falling through to §4.**

---

## 0. 🔴 ACTIVE — UI Revamp in progress, resume here first

**Spec:** [`docs/27-UI-REVAMP.md`](docs/27-UI-REVAMP.md) — self-contained, has its own verified defect
register (D-01..D-15), token spec, motion spec, and an explicit stage-by-stage build order (§9 of that
doc). This section is a progress marker against that build order, not a replacement for it — **read
27-UI-REVAMP.md itself before continuing**, this is just "where we stopped."

**To resume:** *"Read `docs/27-UI-REVAMP.md` and `handoff.md` §0, then continue the UI revamp from Stage
5 (M6 and M8) forward — or pick any remaining Stage 8 polish the founder flags."*

### Session update — branding + dashboard/admin UI polish (local → this push)

Work landed in this commit (not previously on remote). Resume notes for the next person:

- **Rebrand CrewNest → ClerkNest** across docs/README/overview + app chrome; rose brand `#d91b5b`; warm paper dashboard theme in `globals.css` (light + dark). Contrast helper: `scripts/check-theme-contrast.mjs`.
- **Marketing landing** is served from `public/clerknest-assets/index.html` via a Next rewrite in `next.config.ts`. Scroll header fade (transparent → blur) is driven by `public/clerknest-assets/landing-links.js` (prebuilt bundle — don't edit minified JSX). **Do not commit** the root `Clerknest assets/` design-export folder (gitignored).
- **Client Home** (`dashboard/page.tsx`): icon tiles (`HomeIcon`), quota ring, clerks strip (`clerk-strip.tsx`, renamed from crew), upgrade teaser; date formatting via `lib/format-date.ts` (hydration-safe `en-GB`).
- **Orders** (`orders-view.tsx`, shared admin + client): responsive cards; name ` - ` phone; status icons; calendar/clock on Placed; column stacks (Items → Owner/Platform; Payment → Action; Placed + Cancel); payment cell shows Mark paid / Paid / etc. on the **right**; owner **Cancel order** dialog → `cancelOrderAction` (reason required, customer notified). Pending Review → Reject still separate.
- **Admin Overview + System Health**: colored `HomeIcon` tiles per metric card.
- **My Business channels**: `PlatformBadge` next to WhatsApp / Messenger / Instagram / Website.
- **Auth**: marketing panel matches split-screen proof (chips, two-turn chat, channel rail); tighter vertical rhythm so support line fits without scroll; **wrong-portal login** (client on `/admin` or admin on client login) returns only `Invalid email or password.` — no account-type disclosure (`login/actions.ts`).
- **Analytics** (client + admin): added Orders/bookings secured, Handoff rate, Payment conversion (`getCommerceMetrics`); brighter card tints; floating info dialog (`analytics-info-dialog.tsx`) explaining every metric.

### What's done (commits `6a69f69`..`40648e0`, plus later main history — see git log)

Every item below was verified against the **real live app** before being marked done — typecheck +
`npm run build` + the full `vitest` suite every time, and for anything visual, an actual headless-browser
pass (Playwright, installed as a devDependency — `npm ls playwright` to confirm it's still there) with
real screenshots and/or measured pixel values, not eyeballed. Playwright scratch scripts were written to
the repo root, run, then deleted — none are committed; if you see a stray `pw-*.cjs` at the repo root,
it's leftover from a session that didn't clean up and is safe to delete.

- **Pre-revamp QA pass** (`6a69f69`, `befaa23`, `67bb5e7`, `13f8c33`, `1fa5d70`, `de2e5f4`, `ca8a93a`) —
  a full security + mobile-UX audit done *before* `docs/27-UI-REVAMP.md` existed, which is what surfaced
  the need for it. Fixed: a rate-limit bucket-key collision, missing security headers, 10 dependency
  CVEs, the inbox being unusable on a phone (fixed-position panes, broken scroll), a duplicate details
  toggle, tables forcing horizontal page scroll, a Base UI crash in the business switcher (`Menu.
  GroupLabel` used outside `Menu.Group`), `Something went wrong` on sign-out (calling a `redirect()`-
  ending server action outside a `<form>` swallows the thrown `NEXT_REDIRECT`), the mobile tab bar
  overlapping content, and a missing per-business filter on the notifications bell.
- **Stage 0 — Field bugs** (`a4f1d96`) — D-13 (inbox thread panning sideways on an unbreakable token:
  `break-words`+`min-w-0` on the bubble), D-14 (client dashboard's Orders page had a business dropdown
  that lied — read "All clients" while already filtered to one; `showBusinessColumn` forced `false` on
  the client shell, agency side at `/admin/orders` untouched and still correct), D-15 (the free plan's
  20-message cap looked like a broken AI with no explanation and only a destructive recovery path —
  added a `chat_sessions.length_limit_reset_at` column, migration `0047`, a banner explaining what
  happened, a real non-destructive "Let the AI continue this chat" action, and disabled the Human
  takeover switch while that specific handoff is active so it stops silently lying).
  ⚠️ **Migration `0047` was applied by connecting directly to Postgres** (`pg` npm package, installed
  then removed — it isn't a real dependency of the app), **not** via `supabase db push` — that command's
  `--dry-run` showed it would try to replay all 46 prior migrations from scratch, because the CLI's own
  remote-tracking table doesn't know they're already applied (they were applied by hand, same as every
  migration in this project — see §5 item 1). **Do not run a bare `supabase db push` in this repo** until
  someone reconciles that tracking table; it's a landmine, not something this session fixed.
- **D-08 — mobile tab bar** (`f9f3873`) — was silently `.slice(0, 5)`-ing the nav list with no overflow;
  a tenant_admin (8 destinations) or the agency (9) lost real pages with zero way to reach them. Now
  shows 4 + a "More" menu (reuses the existing `DropdownMenu` primitive) for the rest.
- **Stage 3 — Tokens** (`b167047`) — `--success`/`--pending`/`--danger` (+`-text`/`-tint` pairs) and the
  marketing `--stage-ink`/`--stage-deep`/`--stage-warm` (+`-fg` pairs) grounds, both themes. The doc's own
  starting oklch values were flagged as unmeasured — measured for real (canvas-resolve method, since
  computed style resolves to `lab()`/`oklch()` and reading those components as raw RGB gives wrong
  ratios) and `--pending-text` on `--pending-tint` in light mode genuinely failed at 4.48 against the 4.5
  floor; darkened it (lightness only) and re-measured at 5.49.
- **Stage 1 — Marketing critical** (`1dff268`) — M1 (hamburger menu below `md`, reusing `DropdownMenu`),
  M2 (hero demo reordered above the fold on mobile — flattened DOM, grid-placement for desktop, hid
  HeroVisual's secondary "Live dashboard" panel below `sm` since it alone was ~580px tall stacked;
  verified a real message bubble renders inside a 664px viewport with zero scrolling), M3 (44px
  touch-target rule extended to plain `<a>`/`<summary>`, previously buttons-only; the tab-bar exclusion
  narrowed from "every `<nav>`" to just the tab bar via `data-slot="tab-bar"`), M4 (`#features` had no
  heading and wasn't in any nav list — fixed, and a single `SECTION_LINKS` array now drives the desktop
  nav + hamburger + footer so they can't drift apart again).
- **Stage 2 — Dashboard nav** = D-08 above (they're the same fix, doc lists it as its own stage).
- **Stage 4 — Auth** (`7e9ecd7`) — A1 (login's `<h1>` was literally `ClerkNest` — the exact grammar of a
  phishing page; now states the page's purpose), A2 (new shared `AuthShell`, real split-screen on `lg+`
  with a static non-animated proof panel — not a stock illustration — form-only below `lg`), A3 ("what
  happens next" line + a real support address, promoted a duplicated literal in privacy/terms pages to
  `lib/constants.ts SUPPORT_EMAIL` while there), A4 (one line explaining the typed-code-not-a-link
  decision, on both verify screens), A5 (`h-11` on every auth input/submit button — they measured ~32px).
- **Stage 5, partial:**
  - **M5 — colour-blocked sections** (`f023a92`) — the page alternated between two grounds 1.2% apart in
    lightness (`--background` vs `--card`), which is the measured entirety of the "flat, samey" problem.
    Applied the doc's stage sequence; Features needed restructuring (was a single constrained `<section>`,
    can't carry a full-bleed background) into the same two-level wrapper Pricing already used. Added
    `--stage-primary` (not in the doc's original §2 token list — needed because `--primary` at its
    light-theme value is too dark to read well against the fixed-dark `--stage-ink`, and the stage
    doesn't shift with the theme toggle the way `--primary` does).
  - **M9 / D-07 — pricing** (`40648e0`) — Free and Starter ($39) both advertised the *identical* headline
    "Up to 5 customer conversations/day," so Starter had no visible reason to exist. **This needed a
    real decision, asked of and answered by the founder** (not guessed): raise Starter's own cap. Landed
    on **15/day**, not the doc's example of 50 — Growth ($49, one tier up) caps at 20/day, and 50 would
    have made the *cheaper* tier out-volume the pricier one, which the existing "cap never decreases
    going up the ladder" test would have caught. Added a second test asserting each tier's cap actually
    *differs* from the one below it (the old test alone would pass even with two tiers tied).

### What's next — pick up here

Still inside **Stage 5**, both doable with zero blockers, per the doc's own explicit fallback for exactly
this situation:
- **M8 — trust row.** The doc is explicit: **do not invent social proof.** If no honest number exists
  yet for "businesses live" / "messages handled" / etc. (it doesn't, as of this session), ship the
  channel logos (`_landing/platform-icons.tsx` already has them) + a "no card required" line only.
- **M6 — before/after section.** New section between Features and Pricing, on `--stage-deep`. The doc
  says to draw the four pain points from the FAQ copy already in `page.tsx` so the voice matches — that
  copy exists and is real, so this isn't inventing new claims from nothing, just restructuring existing
  ones. Motion spec for this section's reveal is docs/27 §6.2 item 2.

Then continue down the doc's own build-order table (§9 of `docs/27-UI-REVAMP.md`): **Stage 6 (motion,
needs M6 to exist)** → **Stage 7 (channel connection C1 — no backend needed, ships the trust story
immediately)** → **Stage 8 (dashboard: the settled-Home-shape rework, needs-attention as a queue not a
KPI grid, copy substitutions, status pills using the Stage-3 tokens — the single largest remaining
chunk)** → **Stage 9 (two-door hero, "your crew" strip)** → **Stage 10 (the scroll-pinned channel
re-skin — highest effort, purely additive, do it last)**.

**Stage 11 (C2 — Facebook Login for Business / embedded OAuth for Instagram+Messenger) needs YOU, not
just Claude:** an actual Meta App Review submission (screencast, privacy policy already exists at
`/privacy`), a data-deletion callback endpoint, a Meta test user. The *architecture* (OAuth popup →
server-side code exchange → Vault, client never sees a token) is stable and can be built ahead of the
review being approved, but going live needs the review itself. Doc's own advice: **start that paperwork
now, in parallel** — it's the long pole and nothing else in the doc depends on it.

**Two things flagged in the doc but not yet reproduced/investigated this session** (§1 of
`docs/27-UI-REVAMP.md`, "verify before designing around it"):
- Orders "Owner alert" column possibly always reads *Pending* regardless of real status — if real, it's
  a data bug in the orders query, not a UI task.
- Instagram contact avatars possibly render as a broken-image icon in the inbox.
Neither blocks anything above; just don't assume they're fine.

---

## 1. What ClerkNest is

Multi-tenant SaaS: an "AI employee" for small businesses. A client's customers message on
WhatsApp / Messenger / Instagram / a website widget and get accurate, on-brand, catalogue-grounded
answers; the AI can also **take orders**, handle **custom-order media** (image/voice), and the owner
watches + takes over from a dashboard. Two dashboards: **agency/admin** (`/admin`, the operator running
many clients) and **client** (`/dashboard`, a single business owner). Both have a guard-railed **Copilot**
(a Claude-style chat that edits the business by proposing changes the owner one-tap applies).

- **Live:** `clerknest-rouge.vercel.app` (Vercel, GitHub continuous deploy — **pushing `main` = a
  production deploy**). Repo: **`kraftnestco/clerknest`** (moved from `khubaibagha/clerknest` around
  2026-07-27; that move silently broke Vercel's webhook — see §5 item 2).
- **Stack:** Next.js 16 (App Router, Turbopack, RSC) · Supabase (Postgres + Auth + RLS + Vault + Storage)
  · Tailwind v4 · LLM via OpenAI **or** OpenRouter (per-tenant, BYOK or master key).
- **Backing services:** Supabase project (ref in `.env.local`/Vercel env) · Meta Graph API (channels) ·
  Resend (email, optional) · Sentry (errors, optional).

---

## 2. Run it + deploy

```bash
cd src/clerknest
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
  `aiOrchestrator.ts`). ⏸️ **Billing (Stripe + Safepay) — code-complete, DB applied, still untested,
  ON HOLD** (§4d): both providers are built and their schema is live (`0038`, `0045`); **neither has
  ever processed a payment.** Stripe serves international tenants, **Safepay serves Pakistani ones**
  (Stripe cannot onboard PK merchants). Blocked purely on creating the two merchant accounts — §4d.1.
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
  Vercel env still pending (§4c). ✅ **Web push (docs/21) — built, `0037` applied, ✅ VERIFIED LIVE
  2026-08-06**: a real OS notification from PRODUCTION reached a phone, unprompted, from the
  conversation-length handoff. Urgent-only fan-out (`handoff` + `alert_signal`). One gotcha came with
  it — **the notification was labelled `localhost:3000`** — which is a stale subscription, not a bug;
  see §7 "The localhost push notification".
- **Message batching (docs/23) — ✅ built, `0039` applied, ✅ VERIFIED LIVE 2026-08-03 on a real
  Instagram thread.** Two messages a few seconds apart now produce ONE combined reply. Getting there
  required two fixes found during that testing, both now in place — see §4e and `0041`.
  The AI reads a whole burst and replies once instead of firing a turn per message: a **5s** grace
  window (4s → 8s when the nudge landed, then 8s → 5s after a 504 — see §3.1) plus abort-and-restart
  supersession, guarded by an atomic per-session lease. Scoped to the queue-driven channels — the website widget is deliberately unchanged.

  **The two fixes this needed, both non-obvious:**
  1. **`0041` — the pg_cron schedule that never existed.** `inbound-worker/index.ts`'s own header comment
     always claimed it "is invoked on a schedule by pg_cron + pg_net", but no migration ever created one.
     Messages sat in the queue indefinitely until the worker was triggered by hand. Stage P's queue and
     dedup logic were correct all along — only the wake-up call was missing.
  2. **Webhook nudges the worker on arrival** (`api/webhooks/meta/route.ts`). pg_cron's floor is one
     minute, so even with `0041` the worker polled once every 60s — and a grace window of a few seconds
     cannot span a 60s polling gap. Two messages seconds apart landed in *different* worker invocations
     and were answered separately; supersession never fired either, because the first turn's LLM call had
     already finished by the time the second message was looked at. Verified: messages at 09:57:02 and
     09:57:23 → two replies, zero `superseded` rows. The nudge (in `after()`, fire-and-forget) starts
     processing in ~1s instead of 0–60s. pg_cron remains the safety net.

  **Lesson:** a polling interval far larger than a feature's internal timing window makes that feature
  unreachable in practice while every unit test still passes. Both halves worked; the cadence between
  them didn't.
- **Appointment booking (docs/24) — ✅ built, `0042` applied, ✅ VERIFIED END TO END 2026-08-04.**
  A real Instagram conversation booked appointment `#4` with a live Google Meet link
  (`calcom_booking_uid` stored), which also confirms the `CALCOM_*` vars are correctly set in Vercel.
  The flow is day-first: "which day?" → "what time?" → check that time → book.
  Getting there took five separate fixes; §3.2 records them because most were not in the booking code.
  Service tenants with `booking_enabled` get three tools (`check_availability`, `book_appointment`,
  `cancel_appointment`), real slots computed from their own hours/closures/timezone, and dashboards at
  `/admin/appointments` + `/dashboard/appointments` with the per-client filter.
  **ClerkNest owns the schedule; Cal.com only mints a Google Meet link** for tenants whose meetings have
  no home of their own (docs/24 §1.1 explains why Cal.com must NOT own availability: one ClerkNest-owned
  Cal.com account means shared availability, so two tenants would collide on the same hour).
  Verified live: the Cal.com API round trip (slots → book → Meet URL → cancel), the double-booking guard
  (a second booking of the same slot returns null, not an error), that cancelling frees the slot, and now
  a complete customer booking conversation.
  **"Upcoming" means NOT FINISHED, and that lives in `lib/appointmentWindow.ts`, not the database** —
  see §3.2 fault 6. Both appointment pages and `getAppointmentsPageAction` query from a bounded
  `MAX_APPOINTMENT_LOOKBACK_MINUTES` (480) lookback and then filter with `isUnfinished()`; don't
  reintroduce a `starts_at >= now` filter, and don't try to add a generated `ends_at` column.
- **Customer-facing order references (`KN-0803-5`)** — business initials + MMDD + the per-tenant
  sequential number, replacing both the raw uuid and the bare `#5`. In `lib/orderRef`, used by all four
  order tools, the review prompt, and the six admin-triggered messages, so the reference is identical
  whoever sent it.
- **Markdown stripping on outbound replies** — `sanitize.stripMarkdown`, applied in the orchestrator.
  The prompt already forbade markdown explicitly and the model did it anyway; Meta renders none of it,
  so customers saw literal `**` and raw table pipes.
- **UI polish (recent):** logo/wordmark font (Baloo 2), topbar headings, inbox layout, hero anti-jank.

### 3.2 What it took to make booking actually work (2026-08-04)

Booking was "done" on 2026-08-03 and still failed for a full day. Five faults, only one of which was in
the booking code. Recorded because the same shapes will recur.

1. **The prompt was explicitly telling the AI it could not book.** `buildBookingRule` runs whenever no
   external `bookingLink` is set and instructs the model that the business "has no way to actually
   schedule a call", with a GOOD example reading *"We don't have online call booking set up yet"* — which
   is almost verbatim what customers received. The model was obeying an instruction, not ignoring one.
   Now skipped when real booking is on.
2. **Booking guidance was gated on `ordersEnabled`.** It lived inside `buildServiceFlowBlock`, which only
   renders for order-taking tenants. A service business that takes bookings but not orders got the tools
   and no instructions. Booking has its own block now.
3. **`resolveDayHint` sent "tuesday" said ON a Tuesday to next week.** Whether today still has capacity is
   the slot generator's job (it applies lead time); date resolution must not pre-empt it.
4. **A time with no day silently restarted the conversation.** Both tool args are optional, so `{time}`
   without `{day}` fell through to the "which day?" branch. The tool now recovers by assuming the soonest
   available day and saying so.
5. **The leaked-reasoning guard ended conversations instead of retrying.** The model does sometimes ramble
   to the token ceiling and write a literal tool name at the customer — blocking that is right — but the
   check ran AFTER the tool loop and handed off permanently. One bad generation muted the AI for the whole
   conversation. It now runs inside the loop, discards the bad generation, and retries;
   `MAX_TOOL_ROUNDS` went 3 → 5 because retries and tool calls share that budget.
6. **A booking confirmed in chat never appeared on the appointments pages.** The queries filtered
   `starts_at >= now`, so an appointment vanished from "Upcoming" the moment it started — the exact
   window in which staff most need to see it. Two fixes were wrong before the third was right:
   a bare `starts_at >= now` (drops a 4:30pm booking at 4:30pm) and then a blanket lookback (still
   listed it at 6:15pm, long after it ended). The correct rule is `starts_at + duration > now`.
   **A generated `ends_at` column is the obvious way to express that and Postgres refuses it** —
   `42P17`, the interval expression is not immutable; `make_interval` and interval multiplication were
   both rejected. Migration `0044` was written, failed, and was deleted. The rule now lives in
   `lib/appointmentWindow.ts` (`isUnfinished`, `MAX_APPOINTMENT_LOOKBACK_MINUTES`), applied by both
   pages and the paginated action, with both wrong versions pinned as named boundary tests.
   The DB query keeps a generous lookback purely so the exact cut has rows to work on.

**The method lesson, which cost most of the time:** every component passed in isolation — the database
row, the gate expression, the tool registry, the model given the real prompt and tools. Each isolated
test succeeded, so the search kept moving down the stack. The fault was never in a component; it was in
what they composed into. **Two things ended it, both quickly: printing the assembled prompt, and reading
the Vercel runtime log.** When the running system disagrees with every isolated test, reach for those
first — not fifth. `usage_logs` is the cheapest first look: `completion_tokens` at the ceiling (400) means
a runaway generation, and one LLM call where a working turn shows two means the tool was never reached.

### 3.1 Two findings from live testing that outlive their fixes

**Free OpenRouter models are the single biggest source of "the AI is broken".** KraftNest Automations
ran on `openai/gpt-oss-20b:free`, which returned **HTTP 429 on every tool-calling probe**. The symptom
was not an error — the AI cheerfully told customers "we don't have an online booking system" and, on an
order attempt, burned all 3 tool rounds and hit the `tool_exhaustion` handoff. Everything downstream was
working; the model simply never called a tool. Switching to `nvidia/nemotron-3-super-120b-a12b:free`
(3/3 on repeat tool probes, 262k context, free) fixed both immediately.
**Anything tool-based — orders, bookings, reviews — is only as reliable as the model's tool-calling.**
`services/ai/openrouter.ts` carried this warning in a comment from the start; it deserves more weight
than a comment. Probe a candidate model against a real tool schema before putting a client on it.

**OpenRouter's free tier is 50 requests PER DAY, PER ACCOUNT — and exhausting it looks like a broken
feature, not an error.** Hit live 2026-08-03 after an evening of testing. The server log said it
plainly:

    429 Rate limit exceeded: free-models-per-day.
    Add 10 credits to unlock 1000 free model requests per day

Two things make this expensive to diagnose:
- **It is per-ACCOUNT, not per-model.** Earlier the same evening `openai/gpt-oss-20b:free` returned 429
  on every tool probe and I concluded that model was throttled, switching the tenant to
  `nvidia/nemotron-3-super-120b-a12b:free`. That was the wrong lesson: swapping models never addressed
  it, we simply still had budget at the time. A new API key does not help either — the quota is on the
  account, and keys are just credentials pointing at it.
- **The symptom is a plausible-sounding reply, not a failure.** When the LLM call is refused the
  orchestrator falls back to whatever text it can produce, so the AI confidently tells customers things
  like "we don't have an online booking system". Nothing in the product surfaces "we ran out of quota".

`GET https://openrouter.ai/api/v1/key` reports `usage`/`usage_daily` and `is_free_tier`, but
`limit_reset` is **null** for the free-model quota, so there is no reliable way to read the reset time
from the API. It is a daily quota; midnight UTC is the likely reset but is not confirmed by them.
Total spend at the point of exhaustion was **$0.025** — the cap is on request COUNT, not money.

**Practical consequence:** 50 requests/day is not enough to develop against, let alone run a client on.
Adding 10 credits (a one-off, not a subscription) raises it to 1000/day. Until then, expect testing
sessions to die partway through in a way that mimics feature bugs.

**Vercel Hobby's 60s function limit is a real ceiling on the AI turn.** A live turn hit
`process-message bridge failed (504)`; pgmq then correctly retried, which re-ran the turn and persisted
the customer's message twice. `0043` makes that retry idempotent, and `BATCH_GRACE_MS` came down 8s→5s
because the grace window is spent INSIDE that same 60s budget. The duplicate is fixed; **the tightness
is not.** If timeouts persist, the structural answer is to stop routing the turn through a Vercel
function at all — the Supabase worker has no such limit, and `api/internal/process-message` is the only
reason the 60s cap applies.

Migrations live in `supabase/migrations/` (`0001`–`0046` today; there is no `0044` — it was written,
failed, and deleted, see §3.2 fault 6). **ALL APPLIED** as of 2026-08-06 (`0008`, `0035`–`0043`
confirmed 2026-08-04; `0045` and `0046` confirmed 2026-08-06 — all via direct verification, not
assumed). They are
applied **manually** in the Supabase SQL editor — see the drift warning in §5.
**`0043` needed a data cleanup before its index would create** — three duplicate `provider_msg_id` rows
existed, the oldest from 2026-07-15, so the retry bug had been duplicating messages quietly for weeks.
A constraint added to an existing table is worth checking against the data already in it.

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

### 4d. Payment setup (SaaS billing) — **⏸️ ON HOLD 2026-08-06 — code complete both providers, blocked on real accounts**

> **⏸️ HOLD (2026-08-06, agreed with the user).** Both providers are **code-complete and DB-applied**;
> **neither has ever processed a payment.** Work is paused here **by decision, not by a blocker in the
> code** — the remaining work is account creation, which is ops and has its own timeline. **Nothing is
> half-built: do not "finish" 4d by writing more code.** The next action is creating the two merchant
> accounts (§4d.1 below), after which the acceptance criteria in docs/22 §6 and docs/25 §8 can finally
> be run.
>
> **Do not push billing to prod while both providers are unconfigured.** The checkout/portal actions
> fail loudly by design (docs/22 §4, docs/25 §6), so a tenant clicking Upgrade today gets an error, not
> a silent no-op. That is the intended posture, but it means the paywall is visibly broken until the
> env vars land.

#### 4d.1 What "unblocking this" actually requires (ops, in order)

**Stripe (international tenants):**
1. Create a Stripe account — **test mode is enough to start**; business verification can follow.
2. Create **three** recurring Products/Prices matching `PAYWALL_PLANS` (§4d.1a): Starter **$39/mo**,
   Growth **$49/mo**, Pro $79/mo.
3. Note the `price_…` ids → `STRIPE_PRICE_STARTER` / **`STRIPE_PRICE_GROWTH`** / `STRIPE_PRICE_PRO`.
4. Register the webhook endpoint `https://clerknest-rouge.vercel.app/api/webhooks/stripe`; take the
   signing secret → `STRIPE_WEBHOOK_SECRET`. Set `STRIPE_SECRET_KEY`.

**Safepay (Pakistani tenants):**
5. Create a Safepay merchant account + business verification (registration, bank proof, ID). **This is
   the long pole** — start it first; it is independent of everything else.
6. Create the **three recurring plans** at fixed PKR amounts. **They must match `pricePkr` in
   `services/demo/plans.ts`** (Starter Rs 11,000 · Growth Rs 14,000 · Pro Rs 22,000) — the plan carries
   the amount, so these are two halves of one number (docs/25 §3.2).
7. Note the `plan_…` ids → `SAFEPAY_PLAN_STARTER` / **`SAFEPAY_PLAN_GROWTH`** / `SAFEPAY_PLAN_PRO`.
8. Register `https://clerknest-rouge.vercel.app/api/webhooks/safepay`; secret → `SAFEPAY_WEBHOOK_SECRET`.
   Set `SAFEPAY_SECRET_KEY`. **Keep `SAFEPAY_ENVIRONMENT=sandbox`** until a real end-to-end test passes.

**Both:** set every var in `.env.local` **and** Vercel (Production + Preview). Then run the unchecked
acceptance criteria — docs/25 §8 (real checkout, duplicate-webhook no-op, cancellation downgrade) and
the equivalents in docs/22.

#### 4d.1a ⚠️ PRICING CHANGED 2026-08-06 — four tiers now (docs/26)

**Before creating the merchant-account products above, note the prices moved.** Starter is **$39**
(was $29) and there is a **new Growth tier at $49**:

| Plan | Price | Conversations/day | Msgs/conversation | Channels | AI assistant |
|---|---|---|---|---|---|
| Free | $0 | 5 | **20** | **1** | — |
| Starter | $39 | 5 | Unlimited | All | — |
| Growth | $49 | **20** | Unlimited | All | **✓** |
| Pro | $79 | **Unlimited** | Unlimited | All | ✓ |

PKR: Starter Rs 11,000 · Growth Rs 14,000 · Pro Rs 22,000. So §4d.1 needs **three** Products/Prices per
provider, not two, plus `STRIPE_PRICE_GROWTH` / `SAFEPAY_PLAN_GROWTH`.

**Repricing Starter is not a code-only change** — the charged amount lives in the Stripe Price and the
Safepay Plan; `services/demo/plans.ts` only displays it. Change one without the other and the card
advertises a price the customer isn't charged.

**All limits are now genuinely ENFORCED** (they largely weren't before — "One channel at a time" was
marketing copy enforced nowhere). `lib/entitlements.ts` is the single source of truth, read by both
enforcement and the plan cards; docs/26 §3 has the enforcement-point table. **Migration `0046` is
APPLIED and verified (2026-08-06)** — `length_limit` accepted, the four pre-existing handoff causes
still valid, a bogus cause still rejected.

**Both billing providers were re-audited for the new tier** and exercised across all three paid plans
(distinct price/plan ids, reference round-trip, webhook plan gate, forged-reference rejection). That
audit found one more real gap, now fixed: **a tier change made in Stripe's Customer Portal had no code
path at all** — `handleSubscriptionUpdated` only handled dunning, so an upgrade would charge the new
amount while `tenants.plan` kept the old tier. See docs/26 §4.1. Safepay needs no equivalent (no
hosted portal; every activation carries its own plan reference).

**Two live consequences, verified against prod on 2026-08-06:**
- **2 of 8 existing free-plan conversations already exceed 20 customer messages** and will hand off to
  a human on their next inbound message. Correct behaviour, but it will look abrupt — including on the
  KraftNest Automations test tenant.
- **Gating the Copilot at Growth removes it from all 3 current tenants** (all on `free`, all have it
  today). Deliberate product decision — grandfather explicitly if that's not wanted.

#### 4d.1b Signup provisions on FREE, never the selected tier (fixed 2026-08-06)

`provisionTenantAction` used to write the **selected** plan onto the new tenant row. Once
`lib/entitlements.ts` started reading `tenants.plan` to grant real limits, that became an
entitlement bypass: `entitlementsFor()` reads `plan` and **never consults `plan_status`**, so a
visitor could pick Pro at signup, abandon the client-side redirect to checkout, and keep unlimited
conversations, unlimited channels and the Copilot **for free, forever**, with nothing to reconcile it.

Signup now always inserts `plan: 'free'`. `plan_status: 'pending_upgrade'` still records the intent so
the agency can chase an abandoned checkout, and the chosen tier round-trips through the **provider**
(Stripe `metadata.plan_id`, Safepay's `<tenantId>:<planId>` reference) rather than through this row.
**The billing webhook stays the single writer of `tenants.plan`** — the same rule docs/22 and docs/25
already state. Pinned by a test in `entitlements.test.ts`.

#### 4d.2 The one code gap left, deliberately not built

**Signup does not capture `billing_country`.** The column exists, `services/billing.ts` reads it, and
migration `0045` is applied — but until the signup flow collects a country, **every new tenant defaults
to `stripe`**, so a Pakistani tenant cannot self-serve onto Safepay without a manual DB edit. Small
change to `(auth)/signup/`; left out because it was outside the build request. See docs/25 §9 item 6.

> **Update 2026-08-06 — a SECOND provider now exists: Safepay, for Pakistani tenants (docs/25).**
> Stripe **cannot onboard Pakistan-based merchants**, so no configuration of docs/22 could ever charge a
> PK tenant. Safepay was chosen over PayFast (no recurring API) and over direct JazzCash/Easypaisa
> (per-transaction approve flows — wrong for subscriptions; Safepay reaches both wallets anyway).
> - **Routing is by `tenants.billing_country`** (`'PK'` → safepay), in `services/billing.ts` — never
>   tenant choice, because a wrong pick is a card decline the tenant can't self-diagnose. A **stored**
>   `billing_provider` wins over the country, so a live subscription is never re-routed under a tenant.
> - **Three real API differences** shaped the code (docs/25 §3): Safepay has **no customer object**
>   (identity round-trips through a `"<tenantId>:<planId>"` reference string), **no hosted portal**
>   (cancel is in-app), and **the plan carries the price** — `createSubscription` takes only a `planId`.
> - ⚠️ **That last point reversed a decision made in this session.** "Convert USD at checkout" was
>   chosen, then found to be **not expressible** on Safepay's API — there is no per-checkout amount
>   field. Prices are now **fixed PKR plan amounts** (`pricePkr` in `services/demo/plans.ts`).
>   **Repricing is a two-part change:** edit the plan in Safepay's dashboard AND update `pricePkr`.
> - **Migration `0045_safepay_billing.sql` — ✅ APPLIED and VERIFIED 2026-08-06** against the live
>   project (not assumed): all six `tenants` columns readable; `safepay_events` exists; the
>   `billing_provider` CHECK **actually rejects** an invalid value (`23514`, tested with a real write
>   then restored); all existing tenants defaulted to `stripe` (no silent re-routing); and a duplicate
>   ledger insert returns `23505`, so the webhook's dedup gate is live.
> - **Dependency caveat:** `@sfpy/node-sdk@3.0.2` pulls `axios@^0.26.0` (many high-severity advisories).
>   `package.json` pins `overrides: { axios: "^1.19.0" }`; SDK verified working after the override.
>   Re-check on any SDK upgrade.
> - **Verified:** typecheck, lint, 130 tests, `npm run build` all green; 11 new routing/reference unit
>   tests; webhook HMAC exercised for real (valid accepted, wrong rejected, **tampered reference
>   rejected**). **Not verified:** any real checkout — no Safepay account exists yet.
> - **The one gap between "built" and "a PK tenant can self-serve": signup does not capture
>   `billing_country`**, so every new tenant currently defaults to Stripe. See docs/25 §9 item 6.
- **Spec:** [`docs/22-BILLING-STRIPE.md`](docs/22-BILLING-STRIPE.md) (Opus design pass + build,
  2026-07-27). Provider decided **with the user**: Stripe — tenant base is global/mixed and neither
  Stripe nor a local PK gateway had an existing account, so Stripe's international reach won.
- **What shipped:** flat-fee subscriptions on the free/starter/growth/pro tiers (repriced 2026-08-06, see §4d.1a — NOT metered
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
  Starter ($39/mo), Growth ($49/mo) and Pro ($79/mo) Products/Prices to match `PAYWALL_PLANS`, get
  `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`STRIPE_PRICE_STARTER`/**`STRIPE_PRICE_GROWTH`**/`STRIPE_PRICE_PRO`, register the
  webhook endpoint (`/api/webhooks/stripe`) in the Stripe dashboard. Per the Vercel marketplace note
  below, prefer a real provisioned Stripe integration over hand-rolled keys if that path is available.
- **Don't confuse with customer payments:** taking a *customer's* money for an order (bank transfer +
  payment-proof upload) is already built and untouched. 4d is about charging *tenants* for ClerkNest itself.

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
- **Unverified-on-live-traffic features** — ~~message batching~~ (✅ 2026-08-03), ~~appointment
  booking~~ (✅ 2026-08-04), ~~web push~~ (✅ 2026-08-06, see §7). **This list is now empty** — every
  built feature has been exercised against real traffic at least once.

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
| ~~**4d — Payment / SaaS billing**~~ | ✅ **RESOLVED — do NOT re-open.** This row is kept only so a future reader doesn't re-litigate it. | **Both provider decisions are made and BUILT.** Stripe for international tenants (docs/22, 2026-07-27); **Safepay for Pakistani tenants** (docs/25, 2026-08-06) — because Stripe cannot onboard PK merchants at all, which is a hard constraint, not a preference. Flat-fee subscriptions (not metering); webhook is the sole `plan`/`plan_status` writer on both sides, idempotent via `stripe_events`/`safepay_events`; billing stays off-limits to Copilots. Rejected and why: PayFast (no recurring API), direct JazzCash/EasyPaisa (per-transaction approve flows — wrong shape for subscriptions; Safepay reaches both wallets anyway). **What remains is ops, not design (§4d.1).** |
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
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | web push (docs/21) | ✅ Real keypair, `0037` applied, **set in Vercel and confirmed working end to end from production 2026-08-06** (real OS notification on a phone). ⚠️ Subscribe from the **prod URL**, not localhost — see §7 "The localhost push notification". |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, **`STRIPE_PRICE_GROWTH`**, `STRIPE_PRICE_PRO` | billing (docs/22) | ⚠️ **No Stripe account exists yet** — none of these have real values. DB schema (`0038`) is applied and ready. Unlike Resend/push, billing has no safe "unconfigured" no-op mode; the checkout/portal actions will refuse with a clear error until these are real. |
| `SAFEPAY_SECRET_KEY`, `SAFEPAY_WEBHOOK_SECRET`, `SAFEPAY_PLAN_STARTER`, **`SAFEPAY_PLAN_GROWTH`**, `SAFEPAY_PLAN_PRO`, `SAFEPAY_ENVIRONMENT`, `SAFEPAY_USD_TO_PKR` | Safepay billing for PK tenants (docs/25) | ⚠️ **No Safepay account exists yet.** Same fail-loud posture as Stripe. `SAFEPAY_PLAN_*` are Safepay **Plan ids** (`plan_…`) — the plan carries the amount, so repricing also means editing `pricePkr` in `services/demo/plans.ts`. `SAFEPAY_ENVIRONMENT` defaults to `sandbox` so a half-configured deploy can't take real money. |
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
   var usually presents as a silent feature no-op, not a crash. **None of them are set yet** — this is the
   single biggest outstanding ops task, and several finished features are inert without it (see §5.1).

   **⚠️ ROOT CAUSE FOUND 2026-08-02 — THE REPO MOVED.** `khubaibagha/clerknest` →
   **`kraftnestco/clerknest`**. GitHub redirects *git operations* after a transfer, so `git push` kept
   working and gave no hint anything had changed. But **webhooks and app integrations do NOT follow the
   redirect** — Vercel was still watching the old address, so it silently stopped receiving push events.
   Everything observed follows from that one fact:
   - pushes succeeded (redirect) and CI ran (Actions moved with the repo), so GitHub looked healthy;
   - Vercel created **no** deployment after 2026-07-27 — verified via
     `gh api repos/<owner>/clerknest/deployments`, which is a good way to check this independently of the
     dashboard;
   - manual **Redeploy** still worked (Vercel rebuilds from its own stored connection), which made it look
     like a permissions problem rather than a plumbing one;
   - the repo never appeared in the Vercel connect-repo picker, because the picker lists repos for the
     signed-in GitHub identity and the repo now lives under a different owner entirely;
   - the July "`talha62ismail-9787` did not have contributing access" banner was the transfer in progress —
     that GitHub account being relinked to `kraftnestco-6204`, exactly as the banner said.

   **Earlier diagnoses in this doc were WRONG** (a missing Vercel GitHub App installation, needing
   `khubaibagha` to grant repo access, needing Vercel Pro for team members). None of those were the cause;
   ignore them. The local git remote has been repointed to `kraftnestco/clerknest`.

   **Remaining fix (dashboard-only, cannot be done from the CLI):** Vercel → project → Settings → Git →
   **disconnect**, then **reconnect** choosing `kraftnestco/clerknest`. That re-registers the webhook against
   the new address. `kraftnestco-6204` owns the Vercel team, so the repo should be selectable directly — no
   involvement from `khubaibagha` needed. Then push (or Redeploy) and confirm a NEW row appears.

   **Lesson worth keeping:** when pushes succeed and CI is green but no deployment appears, check whether
   the repo moved (`git push` prints a "This repository moved" notice) before theorising about
   permissions. The push output said so plainly and it was overlooked for most of a session.
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

## 5.1 Vercel env vars — exact list, and what breaks without each

Derived from `src/lib/env.ts` (the zod schema is the authority — check it, not this table, if they ever
disagree). **Set these in the Vercel project for BOTH Production and Preview.**

**REQUIRED — the app throws at startup if any is missing.** `env.ts` fails fast by design, so a deploy
without these doesn't degrade gracefully, it crashes on boot:

| Var | Note |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public (anon-safe). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public (anon-safe). |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only, bypasses RLS.** Never expose to the browser. |
| `MASTER_OPENAI_KEY` | Required even for OpenRouter tenants — the schema demands it. |
| `META_VERIFY_TOKEN` | Must match what's configured in the Meta app. |
| `META_APP_SECRET` | Meta App → Settings → Basic. |

**Has a default, but set it explicitly in prod:**

| Var | Note |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Defaults to `http://localhost:3000` — **wrong in prod**. Absolute links and redirects use it. |
| `META_GRAPH_VERSION` | Defaults to `v21.0`. |

**Optional — the feature silently no-ops until set (this is why a missing var looks like "the feature
just doesn't work" rather than an error):**

| Var(s) | Feature that stays dead without it |
|---|---|
| `MASTER_OPENROUTER_KEY` | OpenRouter tenants + the public demo (which runs on OpenRouter, not OpenAI). |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | All email notification fan-out. Domain already verified. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | **Web push (docs/21).** Built and DB-applied, completely inert until all four land. |
| `CRON_SECRET` | `/api/cron/maintenance` AND `api/internal/process-message` (the Stage P worker bridge) reject every request. **Must be the same value in Vercel and as a Supabase Edge Function secret.** |
| `CALCOM_API_KEY`, `CALCOM_EVENT_TYPE_ID`, `CALCOM_ATTENDEE_EMAIL` | **Appointment meeting links (docs/24).** Only for tenants with `booking_mode='calcom'`. Unset ⇒ the appointment still books, just with a blank `meeting_url` (docs/24 §4.3 — a link generator failing must never retract a time already promised). Event type id is `6539354`; attendee email is a single fixed ClerkNest address by decision (§4.4), so Cal.com confirmations land there, not with the customer. |
| `SENTRY_DSN` | Error tracking. |

**Optional but fails LOUDLY rather than silently — deliberate:**

| Var(s) | Behaviour |
|---|---|
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, **`STRIPE_PRICE_GROWTH`**, `STRIPE_PRICE_PRO` | Checkout/portal refuse with a clear error instead of no-op-ing — a paywall that appears to work but never charges would be a worse failure. **No Stripe account exists yet**, so these have no real values. |
| `SAFEPAY_SECRET_KEY`, `SAFEPAY_WEBHOOK_SECRET`, `SAFEPAY_PLAN_STARTER`, **`SAFEPAY_PLAN_GROWTH`**, `SAFEPAY_PLAN_PRO` | Same posture, for PK tenants (docs/25). **No Safepay account exists yet.** Note `getSafepayClient()` also refuses when only the *webhook* secret is missing — a subscription created with no verifiable webhook path would take money we could never confirm, leaving the tenant paid-but-not-upgraded. |
| `SAFEPAY_ENVIRONMENT` | Defaults to `sandbox` — **deliberately**, so a half-configured deploy can never take real money. Must be set to `production` explicitly when going live. |

**Gaps to be aware of (as of 2026-08-02):**
- `.env.local` currently has **no `CRON_SECRET`** and **no `INBOUND_WORKER_SECRET`**. Both are needed for
  the Stage P worker path to function; `INBOUND_WORKER_SECRET` isn't in `env.ts` at all (it's read only by
  the Deno Edge Function), so nothing validates it — it will just 403 silently if missing/mismatched.
- No `STRIPE_*` **or `SAFEPAY_*`** values anywhere, local or prod — billing (§4d) is ⏸️ on hold pending
  both merchant accounts. `.env.example` now documents both blocks (it was missing the Stripe one
  entirely until 2026-08-06).
- `VERCEL_OIDC_TOKEN` in `.env.local` is injected tooling state, **not** something to copy into Vercel.

---

## 5.2 The Vercel/Meta-access checklist — do these IN ORDER once you have access

Everything below is genuinely blocked on Vercel **deploys actually working** (§4b) and/or a Meta Developer
account, tracked here so nothing gets lost across sessions. **Do them in this order** — several later
steps depend on an earlier one.

**Correction (2026-08-02):** an earlier note here blamed a missing Vercel GitHub App installation. That
was **wrong**. The real cause was the repo moving to `kraftnestco/clerknest`, which broke Vercel's webhook
while leaving `git push` and CI working — full write-up in §5 item 2. Disregard the App-installation theory.

**A. Vercel / deploy pipeline — ✅ ALL DONE 2026-08-03.** Kept for the record; skip to B.
- ~~A0. Reconnect Vercel to the moved repo~~ — done. Pushes to `main` now auto-deploy; verified by
  `gh api repos/kraftnestco/clerknest/deployments` showing new `vercel[bot]` rows per push.
- ~~A1. Env vars in Vercel~~ — done (9 added: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_APP_URL`,
  `RESEND_*`, the four `VAPID_*`, `CRON_SECRET`), plus `INBOUND_WORKER_SECRET` for the nudge.
- ~~A2. Confirm deployed URL~~ — `https://clerknest-rouge.vercel.app`.
- ~~A3. Re-point the worker~~ — done: `APP_URL`, `CRON_SECRET`, `INBOUND_WORKER_SECRET` set as Edge
  Function secrets and confirmed via `npx supabase secrets list`.
- ~~A4. Stage P happy path~~ — **verified live**: a real Instagram message went webhook → queue → worker
  → bridge → `handleInboundMessage` → reply delivered. docs/15 §8's open criterion is now met.
- ~~A7. Redeploy the Edge Function worker~~ — done (`npx supabase functions deploy inbound-worker
  --no-verify-jwt`), shipping the 30s→120s visibility-timeout change.
- **Migration `0041` applied** — the pg_cron schedule that was always assumed to exist but never was.
  Confirmed firing every minute via `cron.job_run_details` (status `succeeded`).

**A-remaining. Still open:**
- ~~5. **Web push** (docs/21)~~ — **DONE 2026-08-06.** Confirmed end to end from production
  (Vercel → web-push → FCM → device). Note the `localhost:3000` label gotcha in §7 before re-testing.
6. **Billing** (docs/22 + docs/25) — **⏸️ ON HOLD, see §4d.** TWO providers now, both needing their own
   account: Stripe for international tenants, **Safepay for Pakistani ones** (Stripe cannot onboard PK
   merchants at all). Land the four `STRIPE_*` **and** the six `SAFEPAY_*` vars in Vercel, and register
   **both** webhook endpoints (`/api/webhooks/stripe`, `/api/webhooks/safepay`) against the real
   deployed URL. Full ordered checklist in §4d.1.
7. **Redeploy the Edge Function worker** — `npx supabase functions deploy inbound-worker`. Message
   batching (docs/23) raised `VISIBILITY_TIMEOUT_SECONDS` 30 → 120 **inside the Deno worker**, which
   does NOT ship with the Vercel deploy. Until this is redeployed, a batched turn running past 30s has
   its pgmq row redelivered *while still processing*; the `webhook_events` status gate absorbs the
   duplicate, so it degrades rather than breaks — but that's defence-in-depth doing load-bearing work,
   which is not where you want it.

**B. Meta channel testing — mostly DONE 2026-08-03.**
- ~~B1/B2. Connect a real channel + register the webhook~~ — done. Instagram + Messenger are live on the
  **KraftNest Automations** tenant (`meta_page_id`, `instagram_id`, `meta_token_secret_id` all set).
- ~~B3. Full round trip~~ — verified: real Instagram message → webhook → pgmq → worker → bridge → reply
  delivered back on Instagram.
- ~~B6. Message batching for real~~ — **verified**: two messages a few seconds apart produce ONE combined
  reply. Took two fixes to get there (`0041`'s missing cron schedule, then the webhook nudge) — see §3.
- ~~B7. Tune `BATCH_GRACE_MS`~~ — raised 4000 → 8000 alongside the nudge. Revisit only if real traffic
  shows a meaningful share of `superseded = true` rows in `usage_logs` (that means bursts are still
  escaping the window).

**B-remaining. Still open:**
- ~~4. **Re-test push notifications for real.**~~ — **DONE 2026-08-06, unprompted.** A real OS
  notification ("Conversation length limit reached") arrived on a phone from **production**, triggered
  by the new conversation-length handoff. End-to-end push is confirmed working: Vercel → `web-push` →
  FCM → device. **But it was labelled `localhost:3000` and its link points there** — see §7 "The
  localhost push notification" before concluding anything is broken.
5. **WhatsApp business-initiated messages** (owner notifications, future out-of-window follow-ups) need
   Meta-approved message templates — an ops step in the Meta dashboard, not code (§5 item 4). WhatsApp is
   not yet connected on any tenant (`whatsapp_phone_number_id` is null everywhere).
6. **Poison-message + crash-recovery criteria** (docs/15 §8) remain unchecked — they need artificially
   induced failures (kill the worker mid-turn; a message engineered to always throw), not real traffic.
- ~~7. Test appointment booking end to end~~ — **DONE 2026-08-04.** A real Instagram conversation booked
  appointment `#4` with a live Google Meet link. Also confirms the `CALCOM_*` vars are set in Vercel.
  **Setup, for the next tenant** (all in `/admin/clients/<id>/intake`, NOT the edit dialog):
  `business_type` must be **service** (the tools are gated on it, so switching to product silently
  disables booking), the booking toggle on with a meeting mode, and **business hours AND timezone both
  set** — without them the AI truthfully reports no availability and nothing looks broken. The intake
  form now warns about exactly that.

**B-remaining, still open:**
8. **Appointments still show a bare `#N`**, not the `KN-0803-5` format orders use. `lib/orderRef` is
   already shared, so wiring it into the two appointment tools is a small follow-up.
9. **Cancel and reschedule have never been exercised in a real conversation.** Booking has; the other two
   paths are code-complete and untested against a customer.
10. **A fully-booked day, and a taken time slot**, are both unexercised. The code returns alternatives in
    each case (`alternative_days`, `nearest_times`) but no customer has hit either.

**C. Independent of both (can happen anytime, own timeline):**
- **Billing accounts — the current blocker on 4d (⏸️ on hold).** BOTH are needed; they are separate
  signups with separate verification:
  - **Stripe** (international tenants) — test mode is enough to start + **three** Products/Prices
    matching `PAYWALL_PLANS`: Starter $39/mo, Growth $49/mo, Pro $79/mo (docs/22 §4, repriced per §4d.1a).
  - **Safepay** (Pakistani tenants) — merchant account + business verification (**the long pole, start
    it first**) + **three** recurring plans at fixed PKR amounts matching `pricePkr` (docs/25 §9).
  - Ordered step-by-step for both: **§4d.1**.
- Meta App Review (only needed for real, non-test customer traffic beyond your own test accounts, §7).

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
- **Scratch DB scripts must live inside `src/clerknest/`**, not the OS temp dir — Node resolves
  `node_modules` relative to the importing file, so a temp-dir script can't find `@supabase/supabase-js`.
  Run once, delete immediately; never commit them.
- **`Glob`/ripgrep can time out** on broad `src/clerknest/**` patterns — fall back to listing a specific
  directory.
- **Manual-migration drift** (above) — the #1 source of "works locally, broken in prod."
- **Widget sessions persist their key in `localStorage`** — clear it between manual tests or a muted
  (handed-off) session stays muted on reload.

### The localhost push notification (2026-08-06) — a stale subscription, NOT a bug

**Symptom.** A real push notification arrived on a phone reading "Conversation length limit reached /
KraftNest Automations — a conversation hit the…" and, underneath, **`localhost:3000`**. No dev server
was running at the time, which makes it look like something is badly wrong. Nothing is.

**What that line actually is.** Chrome labels every web notification with the **origin of the service
worker that displayed it** — it is browser chrome, not part of our message and not a URL we sent. The
only `push_subscriptions` row was created 2026-07-31 from a browser tab on `http://localhost:3000`, so
Chrome attributes every push on that subscription to that origin, forever.

**Why it fired with no dev server.** A push subscription lives on the push service, not in our app —
that row's endpoint is `fcm.googleapis.com`. The real path is:

    Vercel (prod) → web-push → FCM (Google) → device Chrome → wakes the service worker → notification

The dev server is nowhere in it. The service worker is installed **in the browser** against the
`localhost:3000` origin and Chrome can wake it whether or not anything is listening on port 3000.
**That is the whole point of a service worker** — it is independent of any open tab or running server.
So this was PRODUCTION working correctly.

**The one genuinely broken part.** Tapping it opens `http://localhost:3000/dashboard/chat?session=…`
and fails. `public/sw.js` resolves the link against `self.location.origin` (line ~48), which is
correct behaviour — the origin is just stale. Cosmetic, and self-inflicted by having subscribed from
localhost.

**Fix / how to avoid it.** Subscribe from the real deployed URL (`clerknest-rouge.vercel.app`), not
localhost, then delete the stale localhost row or it keeps firing duplicates to the same device.
A subscription is bound to the origin it was created on and **cannot be migrated** — origin is part of
its identity. **When testing push, always subscribe from the prod URL.**

**Lesson worth keeping:** a notification that names an origin you didn't expect is telling you where
the SUBSCRIPTION came from, not where the message came from. Check `push_subscriptions.endpoint` and
the subscription's `created_at` before suspecting the sending code.

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
