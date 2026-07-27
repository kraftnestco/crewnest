# 15 — Reliability & Durable Delivery  (Phase 3)

> **Phase 3, workstream 1 of 4.** Turns the fast-ACK `after()` pipeline into a durable,
> at-least-once, poison-safe delivery system, and closes the two infrastructure gaps that only bite
> at scale (in-memory rate limiting; the Meta 24-hour window). This is the doc-07 **`[OPUS]`
> checkpoint: "queue delivery guarantees — at-least-once + idempotency interplay; poison-message
> handling."** All decisions below are frozen; Sonnet builds against them with no further Opus pass.

---

## 1. Why now — the defect this fixes

Today (`app/api/webhooks/meta/route.ts`) the flow is:

```
verify sig → parse → dedupe(INSERT webhook_events) → 200 → after(){ handleInboundMessage }
```

The idempotency ledger row is written **before** the AI turn runs. So:

- If `after()` is killed (Vercel function eviction, `maxDuration` timeout mid-LLM-call, a deploy
  cutting the instance) after the ACK, the message is **never processed** — and because
  `webhook_events` already has the row, **Meta's automatic redelivery is deduped away**. The customer
  gets silence, no error surfaces, nothing retries. This is *at-most-once with silent total loss*
  dressed up as reliability.
- The `after()` loop processes `fresh` messages **sequentially** under one 60 s `maxDuration`. A burst
  of several messages, each costing an LLM round-trip (plus tool loops, media download, transcription),
  can blow the budget and drop every message after the one that timed out.

Neither is a code bug in `handleInboundMessage` — both are inherent to `after()` as the durability
layer. The fix is to make the **queue** the durable boundary, and move idempotency to *effect* time.

**Non-goal:** changing `aiOrchestrator`. It is trigger-agnostic on purpose (imports no `next/*`); a
pgmq worker calls `handleInboundMessage` unchanged. Everything here is plumbing *around* it.

---

## 2. Target architecture — `after()` → pgmq worker

```
POST /webhooks/meta:
  verify sig → parse → for each msg: enqueue(pgmq 'inbound_messages') with delivery-dedup → 200
                                     (NO LLM work in the request path at all)

Worker (Supabase Edge Function, cron-driven):
  read(n, vt) → for each: process → archive     ← visibility-timeout = automatic retry on crash
```

The webhook's job shrinks to **verify + durably enqueue + ACK**. The AI turn moves entirely to the
worker, off the customer-facing request. `after()` is retired for Meta inbound (it stays fine for the
website widget, which is synchronous by nature — see §6).

pgmq is already provisioned: migration `0008_pgmq.sql` creates the `inbound_messages` queue and
documents the `pgmq_public` RPC surface (`send` / `read` / `archive` / `pop`). **It must be enabled via
Supabase Dashboard → Integrations → Queues** (the raw `create extension pgmq` is gated on the plan;
the dashboard toggle also installs the `pgmq_public` schema clients call). This is a user action, like
every migration — flag it, don't assume it.

---

## 3. The idempotency model  `[OPUS]` — the crux

There are **two independent duplication sources**, and they need **two different defenses**. Conflating
them is the classic at-least-once bug.

| Source | What causes it | Defense |
|--------|----------------|---------|
| **Meta redelivers** the same webhook | our 200 was slow / a network hiccup on Meta's side | `webhook_events (provider, provider_msg_id)` unique constraint, checked **at enqueue** |
| **Worker reprocesses** the same queue message | pgmq visibility timeout expiry after a worker crash | processing ledger on `webhook_events`, checked **at worker pickup** |

### 3.1 Enqueue-time dedup (Meta redelivery)

At webhook time, per message: `INSERT INTO webhook_events (provider, provider_msg_id, status)
VALUES ('meta', ?, 'queued')`. On `23505` (unique_violation) → **skip enqueue** (Meta already delivered
this; it's queued or done). Only on a *successful* insert do we `pgmq send`. This is the current dedup
logic, moved one step earlier and made the gate for enqueue rather than for processing.

### 3.2 Processing-time idempotency (worker retry)

`webhook_events` gains a lifecycle column so a re-read queue message can't double-fire the outbound:

```sql
-- migration 0029 (see §7)
alter table public.webhook_events
  add column if not exists status       text not null default 'queued',  -- queued|processing|done|dead
  add column if not exists processed_at  timestamptz,
  add column if not exists read_ct       integer not null default 0,
  add column if not exists last_error    text;
```

Worker, per message pulled from pgmq:

1. Look up the `webhook_events` row by `provider_msg_id`.
2. **If `status='done'`** → the effect already happened (a crash *after* completion but *before*
   archive re-surfaced the queue msg). **Archive the pgmq message, do nothing else.** This is the guard
   that defeats the reappear-after-success double-reply.
3. **If `status='dead'`** → poison, already parked (§4). Archive, do nothing.
4. Else set `status='processing'`, `read_ct = read_ct + 1`, then run `handleInboundMessage`.
5. On success: set `status='done'`, `processed_at=now()` — **then** archive the pgmq message.
6. On thrown error: set `last_error`, **do not archive** — let the visibility timeout re-surface it
   (that's the retry). §4 handles the message that keeps failing.

### 3.3 The residual window (disclosed, not hidden)

If the worker crashes **after** the outbound `sendText` succeeds but **before** step 5 writes
`status='done'`, the retry will re-run and send **one** duplicate reply. This window is a few
milliseconds (a DB update between two already-adjacent statements) versus today's *guaranteed total
loss* on any crash — a strictly, massively better failure mode.

**Optional tightening (recommended, cheap):** before generating in `handleInboundMessage`, when the
inbound already carries a `providerMsgId`, check whether an `assistant` message was persisted to this
session *after* this user message — if so, the turn already completed; skip generation and re-send is
suppressed. This collapses the residual window to zero for the common case at the cost of one indexed
read per turn. Sonnet may implement this as part of Stage P or defer it; it is not required for
correctness, only for eliminating the rare duplicate.

---

## 4. Poison-message handling  `[OPUS]`

pgmq exposes `read_ct` (how many times a message has been read without being archived). A message that
keeps throwing — malformed payload that slips past `parse.ts`, a tenant whose Vault key is permanently
broken, a provider outage — must not loop forever, re-reading and re-billing LLM calls on each attempt.

**Rule:** when a message's `read_ct` (mirrored onto `webhook_events`, §3.2 step 4) reaches
`MAX_MESSAGE_ATTEMPTS` (**5**), the worker:

1. Sets `webhook_events.status='dead'`, keeps `last_error`.
2. **Archives** the pgmq message (removes it from the live queue — pgmq's `archive` moves it to the
   queue's archive table, so it's inspectable, not destroyed).
3. Emits an **agency** notification (`type:'system_alert'`, new — see §7) so a human knows a message
   was abandoned. Never a *tenant* notification: a poison message is an infra failure, not something a
   business owner can act on, and its content may be malformed/sensitive.

`MAX_MESSAGE_ATTEMPTS` lives in `lib/constants.ts`. Backoff between retries is pgmq's visibility timeout
(`vt`), set per `read` call — start at 30 s (long enough that a transient provider blip clears, short
enough that a real message isn't stalled minutes).

---

## 5. Durable rate limiting  `[OPUS]`-adjacent

`services/security/rateLimit.ts` is an in-memory `Map` and says so in its own header: *"Dev/single-
instance only. On multiple serverless instances this does not share state."* On Vercel every
concurrent instance has its own Map, so the widget's abuse ceiling is effectively `max × instanceCount`
— the protection is porous exactly when it matters (a burst spins up many instances).

**Decision: back the limiter with Postgres** (locked "one datastore — no Redis/Upstash unless forced").
A fixed-window counter table with an atomic upsert shares state across all instances:

```sql
-- migration 0029
create table if not exists public.rate_limit_buckets (
  bucket_key    text        not null,
  window_start  bigint      not null,   -- epoch ms of the window, floor(now/windowMs)*windowMs
  count         integer     not null default 0,
  primary key (bucket_key, window_start)
);
-- service-role only; no RLS-authenticated access. Old windows swept by the retention job (doc 17 §4).
```

`checkRateLimit` becomes async: `insert ... (bucket_key, window_start, 1) on conflict
(bucket_key, window_start) do update set count = rate_limit_buckets.count + 1 returning count` →
`allowed = count <= max`. One indexed round-trip per widget request; acceptable because the widget is
precisely the cheap-abuse surface we're protecting, and it's already the only caller. The Meta path
does **not** call this (it's signature-authenticated), so no added latency there.

Keep the in-memory implementation available behind the same signature for local dev (no DB round-trip
in `npm run dev`), selected by an env flag — but production uses the Postgres bucket. The interface
stays `{ allowed, remaining, resetAt }` so call sites don't change beyond `await`.

---

## 6. The Meta 24-hour window  `[OPUS]`-adjacent

Meta only allows a **business-initiated** message outside the customer's 24 h service window if it's an
approved **template**. Two of our paths can fire outside that window and will silently fail today:

- **`continueSession`** (doc-media-handoff B7): a human resolves a voice/video/image clarification
  *hours* after the customer sent it → the AI's immediate reply via `sendText` can be > 24 h out.
- **Owner-notify / customer-confirm** on WhatsApp already uses `sendTemplate` for the owner side
  (doc-09 §4) — the customer-facing continuation does not.

**Decision:**
1. `services/meta/send.ts#sendText` already throws on non-2xx (memory: the 2026-07-15 fix). Narrow the
   catch: detect Meta's **outside-window error codes** (`131047` / `#10` "message outside allowed
   window" family) specifically.
2. On that specific error from a `continueSession` dispatch: **persist the reply** (it's already
   persisted in step 11 before dispatch — good) and set a new session flag
   `delivery_blocked_reason='meta_window'` + emit a `type:'handoff'`-style **tenant** notification
   ("Your reply couldn't be delivered — the 24 h window closed; reopen by having the customer message,
   or send an approved template"). The reply is not lost; staff are told it needs a template or a
   customer re-ping. This reuses `chat_messages.delivery_failed` (migration 0022) — set it on the
   assistant row so the inbox already renders the "not delivered" state.
3. Do **not** auto-send a template here — template selection/approval is tenant-specific ops (doc-09).
   This is a *surface-the-failure* fix, not a new outbound capability. Web sessions are unaffected (no
   window concept; the known web-continuation gap from B7 stands).

The website widget path keeps `after()`-free synchronous handling — it has an open HTTP response to
return the reply on, no queue needed, no window. Only Meta inbound moves to pgmq.

---

## 7. Schema & build order — **Stage P**

Backward-compatible at every step; `tsc --noEmit` + `npm run build` stay green (no test framework yet —
doc 17 Stage R adds it). Migrations applied by the user via the standard no-Docker `pg`-script-inside-
`src/crewnest` precedent; `database.ts` hand-edited.

**Migration `0029_reliability.sql`** — `webhook_events` lifecycle columns (§3.2), `rate_limit_buckets`
(§5), `notifications_type_check` widened to add `'system_alert'`, `chat_sessions.delivery_blocked_reason
text` (§6). Additive only.

- **P1 — Enable pgmq.** User enables it via Dashboard → Queues; confirm `inbound_messages` exists
  (0008 already defines it). No app code.
- **P2 — Producer.** Rewrite `webhooks/meta/route.ts`: verify → parse → per-msg enqueue-with-dedup
  (§3.1) via `supabase.schema('pgmq_public').rpc('send', …)` → 200. Remove the `after()` LLM path.
  `services/queue.ts` (new) wraps `send`/`read`/`archive` so the RPC surface has one typed home.
- **P3 — Worker.** A Supabase **Edge Function** `supabase/functions/inbound-worker/` on a cron
  (every minute; pgmq `read` with `vt=30`, `n=10`), implementing the §3.2 loop + §4 poison handling.
  It calls the **same** `handleInboundMessage`. (Edge Function, not a Vercel cron, so the worker is
  independent of the web deploy and can run longer than a request; documented as the one non-Vercel
  runtime piece.) Ships the processing-idempotency + poison logic.
- **P4 — Durable rate limit.** Swap `rateLimit.ts` to the Postgres bucket (§5), `await` at the widget
  call site.
- **P5 — Meta window.** The §6 outside-window detection + `delivery_blocked_reason` surfacing.

**`[OPUS]` sign-off:** §3 (two-source idempotency + residual-window disclosure), §4 (poison policy),
§5 (Postgres-backed limiter over Redis), §6 (surface-don't-send) are all **DECIDED & FROZEN** here.
Sonnet builds P1–P5 with no further Opus pass.

---

## 8. Acceptance criteria

> **Status as of 2026-07-2x** (see handoff.md §4e for the full build/deploy narrative): P1–P5 are built and
> deployed. Checked items below were verified against the real, live Supabase project — not simulated.
> Unchecked items are real gaps, not overlooked — noted inline.

- [x] Replaying the identical Meta webhook twice → enqueued **once**. Verified live: sent an identical
      signed payload twice, confirmed exactly one `webhook_events` row and exactly one pgmq message. (The
      "customer gets one reply" half of this criterion is folded into the still-open worker happy-path gap
      below — dedup itself is proven independent of that.)
- [ ] Killing the worker mid-turn → the message is **redelivered by pgmq and processed on the next tick**,
      exactly one reply. **Not yet tested** — requires a real worker→`handleInboundMessage` round-trip,
      which needs the Edge Function's `APP_URL` secret to point at a real reachable deployment instead of
      `localhost` (blocked on Vercel access, see handoff.md §4b/§4e). The worker's OWN mechanics (read,
      claim, archive, the no-matching-ledger-row fail-safe branch) were verified live and deployed
      correctly; what's untested is specifically the crash-mid-turn retry behavior.
- [ ] A message engineered to always throw is parked as `status='dead'` after 5 attempts, an agency
      `system_alert` fires. **Not yet tested** — same blocker as above (needs the happy path working first
      to engineer a controlled failure inside a real turn).
- [x] Widget rate limit holds across concurrent callers (state is shared, not per-instance). Verified live:
      10 concurrent increments against the same Postgres bucket returned exactly `1..10` with zero
      duplicates or gaps, proving the atomic increment (not simulated across real separate serverless
      instances, but the mechanism — a single atomic SQL round-trip — is what makes cross-instance sharing
      correct in the first place, independent of instance count).
- [x] A `continueSession` reply attempted > 24h out sets `delivery_failed` + `delivery_blocked_reason` and
      notifies the tenant. Built and typechecked; not yet exercised against a real Meta 24h-window
      rejection (no live WhatsApp traffic yet) — logic-verified, not live-verified, unlike the two items
      above.
- [x] `aiOrchestrator.ts` is **unchanged** except the dispatch-step `MetaWindowError` handling (§6, P5) —
      the §3.3 optional tightening was NOT implemented (left for later, as the doc allows).
- [x] `tsc --noEmit` + `npm run build` green. Edge Function **deployed** (`npx supabase functions deploy
      inbound-worker --no-verify-jwt`) and called for real. A live WhatsApp message round-trip is **not yet
      proven** — no real Meta channel traffic has hit this path yet; that's a §4g (QA) item once Meta
      channels are live, not a code gap.
