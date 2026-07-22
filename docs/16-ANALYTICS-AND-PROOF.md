# 16 — Analytics & the Proof Layer  (Phase 3)

> **Phase 3, workstream 2 of 4.** The measurement layer that lets both the agency and each client
> *see* that the AI employee is working: how much it handled, how often it needed a human, what it
> costs, and how customers feel about it. This is the doc-07 Phase-3 **"analytics: volumes, deflection
> rate, handoff rate, cost per tenant, CSAT."** The **metric definitions and the CSAT capture strategy
> are the `[OPUS]` decisions** — an ambiguous "deflection rate" is worse than none. Frozen below.

---

## 1. Principle — derive from what we already collect

Almost every number here is computable from tables that already exist. We add **no new customer-facing
prompts** and **no new hot-path writes** in Phase 3 — analytics reads existing rows. This keeps the
metered channels (WhatsApp/IG charge per message) uncluttered and avoids coupling a customer's
experience to our reporting.

Sources already in the schema:

| Table | Gives us |
|-------|----------|
| `usage_logs` (tenant, session, tokens, `estimated_cost_usd`, `used_byok`, `created_at`) | cost, token volume, per-model + BYOK-vs-master split |
| `chat_sessions` (`is_human_handoff`, `alert_signal`, `created_at`, `last_message_at`, `platform`) | conversations, handoff rate, sentiment-health, channel mix |
| `chat_messages` (`role`, `created_at`, `delivery_failed`) | messages handled, AI-vs-human reply mix, delivery failures |
| `orders` (`status`, `payment_status`, `amount_total`, `created_at`) | orders/quotes, fulfillment, GMV proxy |
| `orders` review fields (rating, from the order-event-messaging plan) | explicit CSAT (§4) |

---

## 2. Metric definitions  `[OPUS]` — frozen

Every metric is **per-tenant, over a caller-supplied date range** `[from, to)`. The agency view sums
across tenants (RLS lets a platform admin read all); the client view is one tenant, RLS-scoped.

- **Conversations started** = `count(chat_sessions)` with `created_at ∈ range`.
- **Active conversations** = sessions with `last_message_at ∈ range` (engagement, not just new).
- **Messages handled** = `count(chat_messages where role='assistant')` in range — replies the AI
  actually produced (excludes human manual sends? **No** — a manual send is *also* role `assistant`;
  see §2.1 for why we split it out).
- **Deflection rate** = `sessions the AI carried without ever handing off ÷ conversations started`.
  Precise definition: a session counts as *deflected* if, within the range, it has ≥1 assistant
  message **and `is_human_handoff = false` at period end AND no `handoff`/`media_review` notification
  was ever emitted for it.** The notification check is what makes it honest — `is_human_handoff` can be
  toggled back off after a takeover, so the current flag alone would over-count. (This is why doc-15's
  `notifications` rows are the audit trail, not just UI.)
- **Handoff rate** = `1 − deflection`, **broken down by cause** from the notification `type` +
  wording: `requested` (customer asked), `alert` (alert_signal), `tool_exhaustion` (round cap),
  `media_review` (voice/video/image clarification). Cause is derivable because each handoff path emits a
  distinctly-worded notification (see aiOrchestrator §10/§10b, mediaIntake §B6). Store the cause
  explicitly going forward — §5.
- **Cost** = `sum(estimated_cost_usd)` in range, plus two derived rates: **cost / conversation** and
  **cost / handled message**. Split `used_byok=true` (the *client's* spend on their own key) vs
  `false` (spend on our master key = our COGS / margin surface). This split is the single most
  important number for the agency's unit economics.
- **CSAT** = average explicit review rating on fulfilled orders in range (§4), surfaced only when
  `n ≥ MIN_CSAT_SAMPLE` (5) so a single rating doesn't read as "100%".
- **Sentiment health** (proxy, no capture) = distribution of `alert_signal` across active sessions:
  `% frustrated / price_objection / product_doubt / cancellation_risk / clear`. A free, always-on read
  of how conversations *feel* without messaging anyone.

### 2.1 AI vs human authorship

`chat_messages.role='assistant'` covers **both** an LLM reply and a staff manual send (both persist as
`assistant`). For deflection/"messages the AI handled" to be truthful we must distinguish them. Today
there is no marker. **Decision:** add `chat_messages.authored_by text` (`'ai' | 'human' | 'system'`,
default `'ai'`), set to `'human'` in `manualSendAction`/`resolveClarificationAction` and `'system'` for
the `role:'system'` context notes. Backfill is unnecessary (default `'ai'` is the right historical
assumption for existing assistant rows, and `system`-role rows are already identifiable by `role`).
Additive, one column — migration 0030 (§5).

---

## 3. Aggregation strategy  `[OPUS]`

**Decision: compute on-the-fly with indexed range queries — no materialized views in Phase 3.** At this
scale (one agency, tens of tenants, low-millions of rows/year) `count(*) … where tenant_id=? and
created_at ∈ range` with a `(tenant_id, created_at)` index is milliseconds — the same pattern
`overview.ts` already uses for the "needs attention" counts. A materialized/rollup view is a documented
**trip-wire, not a Phase-3 build**: add `analytics_daily` (a per-tenant-per-day rollup, refreshed by
the doc-17 cron) *only* when a range query on `usage_logs`/`chat_messages` crosses ~200 ms — mirroring
the stuff-budget → pgvector trip-wire in doc-12. Premature rollups are a cache-invalidation tax we
don't need yet.

`services/analytics.ts` (new, RLS server client — Server Components only, like `overview.ts`) exposes
one function per metric group, each taking `(tenantId | null, from, to)`:
`getVolume`, `getDeflection`, `getCostBreakdown`, `getSentimentHealth`, `getCsat`. `tenantId=null` =
agency-wide. Each is a small set of `Promise.all`'d aggregate queries. No new hot-path code.

**Indexes (migration 0030):** `usage_logs` already has `(tenant_id, created_at desc)`. Add matching
`chat_sessions (tenant_id, created_at)`, `chat_messages (tenant_id, role, created_at)`, `orders
(tenant_id, created_at)` if not present. Verify before adding (some exist from 0004).

---

## 4. CSAT  `[OPUS]` — reuse the review, don't spam the channel

We already ship a **post-fulfillment review**: when an order is fulfilled, the AI invites a rating and
`submitReview` persists it (order-event-messaging plan, Phase B). That is a real, transaction-anchored
satisfaction signal we already collect and already gate behind the customer's own reply — **it is our
CSAT.** Phase 3 does not add a second, conversation-level "rate this chat 1–5" prompt, because:

- On WhatsApp/IG every prompt is a billable, interruptive message; a satisfaction ping after *every*
  conversation is exactly the spam that makes customers mute a business.
- The order review already captures the highest-intent moment (someone who bought and received).

**Decision:**
1. **Explicit CSAT** = aggregate of existing order review ratings (`avg`, count, distribution) per
   tenant per range. Zero new capture. Surfaced with the `MIN_CSAT_SAMPLE` guard (§2).
2. **Sentiment health** (§2) is the always-on, no-capture companion for tenants without enough orders
   to have review volume (service businesses, new tenants).
3. A per-tenant **opt-in** "ask for a 1-tap conversation rating after an AI-resolved (non-handoff)
   conversation" is **designed but flagged, not built** — `tenants.csat_prompt_enabled boolean default
   false`. If a client later wants it, Sonnet wires an AI-emitted rating request + a parser (reuse the
   review-parse path). Kept out of the default so we never spam by default. This is the one deferred
   sub-item; everything else in §4 ships from existing data.

---

## 5. Schema & build order — **Stage Q**

**Migration `0030_analytics.sql`** — `chat_messages.authored_by text default 'ai'` (§2.1),
`chat_sessions.handoff_cause text` (§2, nullable; set at handoff-emit time in aiOrchestrator/mediaIntake
alongside the existing notification), `tenants.csat_prompt_enabled boolean default false` (§4.3), plus
the §3 covering indexes. Additive; existing rows default correctly.

- **Q1 — Schema + authorship markers.** Migration 0030; set `authored_by='human'` in
  `manualSendAction` + `resolveClarificationAction`; set `handoff_cause` at each of the four
  handoff-emit sites (one-line additions next to the already-present `notifyBoth`). Hand-edit
  `database.ts`.
- **Q2 — `services/analytics.ts`.** The five aggregate functions (§3), RLS server client, agency +
  tenant variants via `tenantId|null` exactly like `overview.ts`.
- **Q3 — Agency analytics page** `app/admin/analytics/page.tsx`: date-range selector (7/30/90d),
  headline cards (conversations, deflection %, cost split BYOK-vs-master, CSAT), a per-tenant table
  sortable by cost/volume/deflection (the agency's unit-economics view), and a sentiment-health bar.
  New sidebar nav item.
- **Q4 — Client analytics** on `app/dashboard/` (expand the doc-14 §6 "value teaser" into a real
  tenant-scoped page/section): their conversations handled, deflection, sentiment health, CSAT, and —
  deliberately — **not** cost (a client on our master key shouldn't see our COGS; a BYOK client can see
  *their* spend). This is the "proof it's working" surface that de-risks churn.
- **Q5 — Trip-wire note only.** Document the `analytics_daily` rollup as the scale escape hatch in this
  doc; do not build it.

**`[OPUS]` sign-off:** §2 metric definitions (esp. the notification-backed deflection rule and the
AI-vs-human authorship split), §3 on-the-fly-over-materialized decision + trip-wire, §4 CSAT-via-review
+ no-default-spam are **DECIDED & FROZEN**. Sonnet builds Q1–Q4 with no further Opus pass.

---

## 6. Acceptance criteria

- [ ] Agency analytics shows conversations, deflection %, handoff breakdown by cause, BYOK-vs-master
      cost split, and CSAT for a chosen range; numbers reconcile against hand-counted rows on a seeded
      tenant.
- [ ] Deflection does **not** over-count a session that was handed off then handed back (notification
      audit trail catches it).
- [ ] A manual staff reply is **not** counted as an AI-handled message (`authored_by='human'`).
- [ ] Client analytics shows their own numbers, RLS-scoped, and never another tenant's or the agency's
      master-key cost.
- [ ] CSAT reads "not enough data yet" below 5 ratings rather than a misleading percentage.
- [ ] No new customer-facing message is emitted by any Stage-Q code (grep: analytics touches no
      `sendText`/`sendTemplate`).
- [ ] `tsc --noEmit` + `npm run build` green; deployed.
