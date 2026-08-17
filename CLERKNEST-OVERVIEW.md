# ClerkNest — System Description (state as of 2026-08-05)

A factual description of what ClerkNest is and what is actually implemented. Written to brief an LLM
that has no other context on the project. Distinguishes **shipped and verified against real traffic**,
**shipped but unverified**, **designed but unbuilt**, and **stub**.

---

## 1. What the product is

ClerkNest is a **multi-tenant SaaS that gives small businesses an "AI employee."** A client business's
own customers message it on WhatsApp, Facebook Messenger, Instagram DMs, or a website chat widget, and
an LLM answers in the business's brand voice, grounded in that business's catalogue and knowledge base.
The AI does not just answer questions — it **takes orders, books appointments, checks stock, collects
payment instructions, and hands off to a human** when it should not act alone.

Two audiences, two dashboards:

- **Agency / operator (`/admin`)** — a `platform_admin` who runs many client businesses. Sees all
  tenants, onboards them, watches every conversation.
- **Client / business owner (`/dashboard`)** — a `tenant_admin` scoped to one business. Same data
  layer, isolated by row-level security.

Both dashboards carry a guard-railed **Copilot**: a chat that edits the business by *proposing* changes
the human applies with one tap.

**Positioning note:** the first clients are Pakistani SMBs, which shapes real design decisions —
notably that customer payment defaults to Cash on Delivery and manual bank/wallet transfer, because
Stripe is not available in Pakistan.

---

## 2. Stack

| Layer | Choice |
|---|---|
| Framework | **Next.js 16** (App Router, RSC, Turbopack), React 19 |
| Language | TypeScript, strict; Zod for all boundary validation |
| Database / auth / storage | **Supabase** — Postgres, Auth, RLS, Vault, Storage, Realtime, pgvector, pgmq, pg_cron |
| Styling | Tailwind v4 (CSS-first, no config file), shadcn-style components on Base UI |
| LLM | Provider abstraction over **OpenAI** and **OpenRouter**, per-tenant choice, BYOK or platform master key |
| Payments (SaaS billing) | Stripe SDK |
| Email | Resend |
| Push | Web Push (VAPID) via `web-push` |
| Errors | Sentry |
| Meetings | Cal.com API (link generation only) |
| Tests | Vitest |
| Hosting | Vercel (Hobby), continuous deploy from `main` on GitHub `kraftnestco/clerknest` |

**Next.js 16 specifics that matter:** middleware is renamed `proxy.ts`; `cookies()`/`headers()` are
async; `params`/`searchParams` are Promises; `after()` runs work post-response.

Live at `clerknest-rouge.vercel.app`. **Pushing to `main` deploys to production** — there is no staging
branch.

---

## 3. Architecture

### 3.1 Multi-tenancy and security

Every table has RLS with explicit policies. A `tenants` row is the tenant boundary; `user_tenants` maps
users to tenants with a role. `platform_admin` sees everything; `tenant_admin` sees one tenant. There
are three Supabase client factories: browser (anon), server (RLS-respecting, user session), and
service-role (`server-only`, bypasses RLS, never importable into a client component).

Non-negotiables enforced throughout:

- **Zero secrets on the client.** All LLM and Meta calls are server-side.
- Per-tenant API keys (LLM, Meta tokens) are **Supabase Vault references** (`*_secret_id` uuid columns),
  decrypted server-side in memory only. Never returned, logged, or put in a prompt.
- Meta webhooks verify `X-Hub-Signature-256` over the **raw request body** before parsing.
- Every inbound webhook event is idempotent via a `webhook_events` ledger; Stripe has its own
  `stripe_events` ledger following the same pattern.

### 3.2 The inbound message path (the core loop)

Currently, for Meta channels:

```
Meta → /api/webhooks/meta
  verify signature → parse → per-message insert into webhook_events (a 23505 unique
  violation IS the dedup gate: duplicate → skip) → enqueue to pgmq → return 200
  → after(): fire-and-forget "nudge" HTTP call to wake the worker immediately

Supabase Edge Function `inbound-worker` (Deno, separate runtime)
  woken by the nudge (~1s) or by a pg_cron schedule every 60s as the safety net
  → pgmq read with a 120s visibility timeout → processing-idempotency state machine
  → poison handling (5 attempts → status='dead' + agency alert → archive)
  → HTTP POST to /api/internal/process-message (CRON_SECRET-gated bridge)

/api/internal/process-message → handleInboundMessage (aiOrchestrator)
```

The website widget bypasses the queue and calls the orchestrator directly through `/api/chat`.

**Why the nudge exists (a real bug, worth understanding):** pg_cron's minimum interval is 60 seconds,
but message batching uses a ~5 second grace window. Two messages seconds apart landed in *different*
worker invocations and got two separate replies. A polling interval far larger than a feature's
internal timing window makes that feature unreachable in practice while every unit test still passes.

### 3.3 The AI turn (`services/aiOrchestrator.ts`)

`handleInboundMessage` runs: resolve tenant/session → plan caps check → persist inbound message →
**message batching** (wait out a grace window, absorbing a burst into one turn) → build prompt →
tool-calling loop (max 5 rounds) → guardrails → persist reply → dispatch to the channel → log usage.

Notable behaviours:

- **Message batching** — a 5s grace window plus abort-and-restart supersession, guarded by an atomic
  per-session lease. Two messages a few seconds apart produce **one** combined reply.
- **Handoff kill switch** — `[HUMAN_HANDOFF]` in the model output, or an owner taking over in the
  inbox, mutes the AI for that session.
- **Leaked-reasoning guard** — if the model rambles to the token ceiling and writes a literal tool name
  at the customer, that generation is discarded and retried *inside* the loop (it used to hand off
  permanently, muting the AI for the whole conversation after one bad generation).
- **Markdown stripping** — Meta renders no markdown, so `**bold**` and table pipes reached customers
  literally. Outbound replies are stripped.
- **Vision** — images are downloaded server-side with the tenant token into a private bucket; a
  text-only retry path exists when a model rejects image content.
- **Meta 24-hour window** — outside-window send errors (`131047`/`#10`, checked by code not message
  string) throw a distinguishable `MetaWindowError`; the reply is marked undelivered and the tenant
  notified rather than the error vanishing.
- **Rolling memory** — conversation summarisation keeps long threads inside the context budget.

### 3.4 Prompt construction (`services/ai/promptBuilder.ts`)

Deterministic, cache-safe composition — blocks are assembled in a stable order from stable parts so
the cached prefix stays byte-identical per tenant configuration. Blocks include `## STYLE`,
`## LANGUAGE`, `## CATALOGUE`, `## KNOWLEDGE`, `## RULES`, `## ORDER FLOW`, `## SERVICE FLOW`,
`## APPOINTMENT BOOKING`, `## CUSTOM ORDERS`, `## PAYMENT`, `## STOCK`, `## PENDING REVIEW`. Each is
gated on tenant configuration.

**A lesson embedded here:** booking silently failed for a day because `buildBookingRule` was actively
telling the model the business "has no way to actually schedule a call," and booking guidance was
nested inside an order-taking block that service tenants never rendered. The model was obeying an
instruction, not ignoring one. **When a feature works in isolation but not in the running system,
print the assembled prompt first.**

---

## 4. Implemented features

### 4.1 Channels

| Channel | Status |
|---|---|
| Instagram DMs | ✅ Live, verified end to end on a real account |
| Facebook Messenger | ✅ Live, verified |
| Website chat widget | ✅ Shipped (origin allow-list, config endpoint, session key in localStorage) |
| WhatsApp | ⚠️ Code paths exist; not connected on any tenant. Business-initiated messages need Meta-approved templates (an ops step). |
| Voice / SIP | ❌ 501 stub at `/api/webhooks/voice` — Phase 4, no design doc yet |
| Shopify catalogue sync | ❌ 501 stub at `/api/webhooks/shopify` |

Meta onboarding is currently **manual token paste** into Vault; embedded-signup OAuth is the later
upgrade against the same columns.

### 4.2 Orders

Tools the model can call: `create_order`, `edit_order`, `cancel_order`, `check_order_status`,
`submit_review`, `flag_image_ambiguous`. All gated on tenant configuration; identity is **server-bound
to the session** so a customer can never touch another session's or tenant's order.

- Atomic order creation with a dedupe fingerprint (a Postgres function, because a plain upsert cannot
  express it).
- **Two decoupled state axes**, deliberately: `order_status` (`pending`/`confirmed`/`cancelled`/
  `fulfilled`) is the fulfilment lifecycle; `payment_status` (`unpaid`/`awaiting_verification`/`paid`/
  `refunded`/`failed`) is money. Payment never mutates fulfilment and vice versa. A COD order is
  legitimately `confirmed` and `unpaid`.
- **Edit/cancel guard table** — a `paid` or `fulfilled` order is beyond the AI's authority and hands
  off to a human. Editing a custom order under approval re-opens it to `pending`.
- **Custom orders + media intake** — image and voice attachments, an owner approval queue, private
  `order-media` bucket with short-TTL signed URLs.
- **Customer-facing order references** — `KN-0803-5` (business initials + MMDD + per-tenant sequential
  number), shared via `lib/orderRef` so the reference is identical whoever sends it.
- **Order status messaging + reviews** — status changes message the customer; a review prompt follows.
- **Inventory** — stock tracking with `set_stock` / `restock` actions and a `## STOCK` prompt rule.

### 4.3 Payments — two separate systems, do not conflate

**(a) Customer payments** (a business's customer paying for an order) — local-first, no Stripe.
`PaymentMethod` is `cod | manual_transfer | gateway`.

- ✅ **COD** and ✅ **manual transfer** (JazzCash / EasyPaisa / bank — the tenant's own free-text
  instructions, read out verbatim by the AI) are shipped end to end.
- ✅ **Payment proof** — the customer sends a receipt screenshot; a server-side routing rule (never the
  model's say-so, never the image caption) attaches it to the most recent open unpaid manual-transfer
  order and moves it to `awaiting_verification`. The owner then Verifies → `paid` or Rejects.
- ❌ **Hosted gateway (Safepay / PayFast)** — fully designed and frozen in `docs/11` §6, **not built**.
  No `PaymentProvider` interface, no factory, no payment webhook route.

Two money-safety invariants hold across the whole tool surface: **the model can never set
`payment_status`, and never supplies a charge amount.** Model-supplied `items[].price` yields only an
*advisory* total for COD/manual transfer, which the owner verifies anyway; a gateway charge would have
to re-derive an authoritative amount from the catalogue. `→ paid` comes only from a human dashboard
action or a signature-verified webhook.

**(b) SaaS billing** (ClerkNest charging its client businesses) — **Stripe only.**

- Flat-fee subscriptions on free / $39 Starter / $49 Growth / $79 Pro (docs/26). Hosted Stripe Checkout + Customer Portal,
  zero custom card UI.
- The Stripe webhook is the **sole writer** of `tenants.plan` / `plan_status`, idempotent via
  `stripe_events`.
- ⚠️ **Code-complete, DB applied, never tested** — no Stripe account exists and the four `STRIPE_*`
  env vars are unset. Checkout/portal deliberately throw a clear error rather than silently no-op,
  because a paywall that appears to work but never charges is the worse failure.

### 4.4 Appointment booking

Tools: `check_availability`, `book_appointment`, `cancel_appointment`, gated on
`bookingEnabled && businessType === 'service'`.

- ✅ **Verified end to end** on a real Instagram conversation with a live Google Meet link.
- **ClerkNest owns the schedule; Cal.com only mints a meeting link.** Cal.com must *not* own
  availability — one ClerkNest-owned Cal.com account means shared availability, so two tenants would
  collide on the same hour. Slots are computed from each tenant's own hours, closures, and timezone.
- Day-first conversation flow: "which day?" → "what time?" → check → book.
- Double-booking guard; cancelling frees the slot.
- **"Upcoming" means NOT FINISHED**, i.e. `starts_at + duration > now`. This lives in
  `lib/appointmentWindow.ts`, **not** the database — Postgres refuses a generated `ends_at` column
  (error `42P17`, the interval expression is not immutable). Both appointment pages query from a
  bounded lookback and then filter in code.
- Still unexercised in a real conversation: cancel, reschedule, a fully-booked day, a taken slot.
  Appointments also still show a bare `#N` rather than the `KN-0803-5` order reference format.

### 4.5 Knowledge / RAG

pgvector knowledge base with chunking and embeddings, folded into the prompt as a
`## KNOWLEDGE (reference data)` block. Catalogue supports both structured data and free-form text,
with an AI catalogue parser and a "magic import."

### 4.6 Dashboards

**Agency (`/admin`):** overview, clients list, per-client intake wizard, Live Inbox (realtime, take-over
kill switch, manual send), orders, appointments, analytics, system health, Copilot, settings, account.

**Client (`/dashboard`):** overview, business profile, inbox, orders, appointments, inventory, team,
analytics, billing, account.

**Intake wizard** — the per-client onboarding surface: brand persona, catalogue, business type, hours
and timezone, channels, orders/custom-orders/payments toggles, booking configuration, knowledge base.
It warns when booking is enabled but hours or timezone are missing, because without them the AI
truthfully reports no availability and nothing looks broken.

**Copilots** — both are propose/apply, never direct-write:
- *Business Copilot* (owner): profile edits plus `invite_team_member` / `set_stock` / `restock`.
- *Admin Copilot* (agency): read-only triage plus those same three actions targeting a named client,
  via a business-name resolver that refuses on zero or multiple matches rather than guessing.
- **Permanently off-limits to every Copilot:** `llm_provider`, `llm_model`, any `*_secret_id`, `plan`,
  `plan_status`, `free_monthly_cap_usd`, `daily_cost_alert_usd`, `is_active`, `message_retention_days`,
  channel ids, `slug`, and all billing. No tool exists for them and the appliers hard-reject them.

### 4.7 Notifications

Three sinks fanned out from `services/notifications.ts`: **in-app** (a `notifications` table + a
dashboard bell), **email** (Resend, domain `mail.kraftnest.co` verified, real sends confirmed), and
**web push** (VAPID, service worker, `push_subscriptions` table, urgent-only fan-out for `handoff` and
`alert_signal`). Push is built and its env vars are in Vercel, but **a real end-to-end push has never
been confirmed** — it is a no-op by design when unconfigured, so silence means the vars didn't take,
not that the code is wrong.

### 4.8 Self-serve signup and plan caps

Public signup provisions a tenant. Free-plan caps: a daily session cap and a **rolling 30-day** cost
ceiling. When a tenant crosses the ceiling, `plan_status` flips to `cap_reached` with exactly one
owner + agency notification (no spam on repeated blocked turns); when windowed spend drops back under
the cap, the next turn clears it automatically — no cron job, no admin button.

### 4.9 Reliability, analytics, lifecycle

- **Durable delivery** — pgmq queue + Edge Function worker + poison handling (above).
- **Postgres-backed rate limiting** — an atomic `increment_rate_limit_bucket` function in production
  (a plain PostgREST upsert cannot express "increment on conflict"); an in-memory Map in local dev so
  `npm run dev` pays no round-trip. Fails open, always logged.
- **Analytics** — usage logs, cost tracking per turn, admin and client analytics pages.
- **Data lifecycle / GDPR** — retention windows and erasure.
- **System health** (`/admin/health`) and a maintenance cron with a daily cost alert.
- **Team management** with invitations; **customer identity** resolution across channels; **referrals**.

---

## 5. Not built

- **Voice AI** (Phase 4) — SIP transcripts → orchestrator → TTS. The 501 `webhooks/voice` route is the
  intended seam. No design doc exists; this is the largest undefined chunk.
- **Hosted payment gateway** (Stage L) — designed and frozen, unbuilt.
- **Scheduled proactive follow-up messages** — designed, on hold.
- **Shopify sync**, template/persona marketplace, multi-agent "crew" workflows, white-label, granular
  team roles, audit-log UI.

---

## 6. Operational realities worth knowing

These are not incidental — they have each cost real debugging time.

- **Migrations are applied by hand** in the Supabase SQL editor. There is no auto-apply, so drift is a
  standing risk. `0001`–`0043` are all applied as of 2026-08-04. Migrations are written idempotently
  (`create ... if not exists`).
- **Free OpenRouter models are the single biggest source of "the AI is broken."** The free tier is
  **50 requests per day, per account** (not per model, and a new API key does not help — the quota is
  on the account). When the LLM call is refused, the orchestrator falls back to whatever text it can
  produce, so the AI *confidently tells customers things like "we don't have an online booking system"*
  rather than surfacing an error. Anything tool-based is only as reliable as the model's tool-calling —
  probe a candidate model against a real tool schema before putting a client on it.
- **Vercel Hobby's 60s function limit is a real ceiling on the AI turn**, and the batching grace window
  is spent inside that same budget. A 504 caused pgmq to retry and persist a message twice; that retry
  is now idempotent, but the tightness is structural. The proper fix is to stop routing the turn
  through a Vercel function at all — the Supabase worker has no such limit.
- **Env is cached at module load** — restart the dev server after editing `.env.local`.
- **Run the full `npm run build`, not just `tsc`** — a `server-only` module pulled into a client bundle
  only fails at build time, and this has bitten the project before.
- **`'use server'` files export async functions only** — a non-async export there crashes at runtime.

---

## 7. Working conventions

- **Opus designs, Sonnet builds.** Anything touching a locked interface, money, auth, or a novel
  external integration is an `[OPUS]` design checkpoint first; mechanical implementation is Sonnet.
- `docs/` is the source of truth, read in order: `README` → `01-ARCHITECTURE` → `02-SECURITY` →
  `03-DATABASE` → `05-AI-PIPELINE` → `06-INTEGRATIONS` → `07-PHASES` → `08-IMPLEMENTATION-GUIDE`, then
  the numbered feature docs `09`–`24`.
- Never print or commit a secret value; reference it by variable name.
- Push to `main` is a production deploy — commit freely, push only on confirmation.
