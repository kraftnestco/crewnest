# 23 — Message Batching (read-all-then-reply-once)

**Status:** design, pending implementation
**Supersedes:** nothing. Extends docs/15-RELIABILITY-AND-DURABILITY.md (the pgmq pipeline) and
docs/05-AI-PIPELINE.md §1 (the turn).

---

## 1. The problem

Today every inbound customer message produces its own independent AI turn. Verified end to end:

- `api/webhooks/meta/route.ts` loops `parseMetaWebhook()`'s output and calls `enqueueOnce(msg)` per
  message — one pgmq row each, no coalescing.
- `supabase/functions/inbound-worker` reads up to `BATCH_SIZE=10` rows per tick *for throughput*,
  then does `for (const row of rows) await handleOne(row)` — each row is its own bridge call.
- `aiOrchestrator.handleInboundMessage()` takes exactly one `InboundMessage` and produces exactly
  one reply.

So a customer sending

> hey
> are you open today?

gets two separate replies, the first answering only "hey". Humans don't do that: a person reads the
whole burst, then answers once. This document specifies how CrewNest does the same.

**Scope decision (confirmed with the owner):** the fix lands in the **queue/worker layer only** —
WhatsApp, Messenger, Instagram. The website widget (`api/chat/route.ts`) is a synchronous
request→reply HTTP call where the visitor is watching the page; batching there would mean holding a
request open while polling for more input, which fights the channel's shape. The widget keeps its
current instant single-message behaviour.

---

## 2. Chosen behaviour

Two mechanisms, both required:

**(a) Grace window.** When a turn is about to start for a session, wait a short fixed period
(`BATCH_GRACE_MS`) and fold in anything else that arrives for that session during it. This catches
the common "same breath" burst without any delay for a lone message beyond the fixed window.

**(b) Supersession (abort-and-restart).** If a new message for that session arrives *after* the
grace window — while the LLM call is already in flight — the in-flight call is **aborted**, its
output discarded, and a fresh call is issued with every message combined. The customer never sees a
reply that answered only part of their burst.

The owner explicitly chose (b) over the simpler "answer it on the next turn" alternative. It is
strictly more work and has real failure modes; §5 exists to contain them.

---

## 3. State

### 3.1 New columns on `chat_sessions` (migration `0039`)

| column | type | purpose |
| --- | --- | --- |
| `turn_lease_until` | `timestamptz null` | The per-session turn lock. Non-null and in the future ⇒ some worker owns the turn. Expires so a crashed worker cannot deadlock the session forever. |
| `turn_lease_id` | `uuid null` | Who owns the lease. A worker may only release/renew a lease it still owns — guards the "my lease expired and someone else took it, but I'm still running" case. |
| `inbound_epoch` | `bigint not null default 0` | Monotonic per-session counter, incremented on **every** persisted inbound customer message. The supersession signal. |

`inbound_epoch` is what makes (b) possible without any cross-process messaging: a worker snapshots
the epoch before it calls the LLM, and a cheap poll asks "has the epoch moved?". No LISTEN/NOTIFY,
no Redis, no shared memory between the Deno worker and the Vercel route.

### 3.2 Atomic lease claim

Claiming must be a single statement — a read-then-write races two workers into the same session.
Migration `0039` also adds:

```sql
create or replace function claim_session_turn(p_session_id uuid, p_lease_id uuid, p_ttl_seconds int)
returns boolean
language sql
security definer
set search_path = public
as $$
  update chat_sessions
     set turn_lease_until = now() + make_interval(secs => p_ttl_seconds),
         turn_lease_id    = p_lease_id
   where id = p_session_id
     and (turn_lease_until is null or turn_lease_until < now())
  returning true;
$$;
```

Returns `true` exactly once per free lease; a losing caller gets no row (⇒ `false`). Companion
functions `renew_session_turn(session_id, lease_id, ttl)` and `release_session_turn(session_id,
lease_id)` both carry `and turn_lease_id = p_lease_id` so a stale owner is a no-op, never a
clobber.

---

## 4. The flow

`handleInboundMessage` splits into two phases. Phase 1 is unconditional and cheap; phase 2 is
guarded by the lease.

### Phase 1 — always, for every message (unchanged semantics + epoch bump)

1. Resolve tenant, find/create session (existing steps 1–2b, including the free-plan caps).
2. Sanitise, process media (existing steps 3–3b).
3. **Handoff gate** (existing step 4) — still a hard stop, no batching, no lease. A handed-over
   session never runs an LLM turn, so none of this applies to it.
4. Persist the user message (existing step 5) **and bump `inbound_epoch` in the same transaction.**

Phase 1 is what guarantees no message is ever lost: whatever happens to the turn, the customer's
words are already in `chat_messages` and visible in the inbox.

### Phase 2 — the turn, lease-guarded

5. Try `claim_session_turn`. **If it fails**, return immediately with
   `{ sessionId, replyText: null, handoff: false, batchedInto: 'in-flight' }`. The worker archives
   the pgmq row as *successfully handled* — because it was: the message is persisted, the epoch is
   bumped, and the in-flight turn that owns the lease is now obligated to pick it up (§5.2). This
   is the single most important correctness point in the design.
6. Sleep `BATCH_GRACE_MS`.
7. Snapshot `epoch₀ = inbound_epoch` (read *after* the sleep, so it covers everything that landed
   during it).
8. Run the turn (existing steps 6–12) — `messages.loadWindow()` already re-reads `chat_messages`
   fresh, so every message persisted by phase 1 during the grace window is in the prompt with no
   new query. The final user turn is built from **all** user messages newer than the last assistant
   reply, joined newest-last (§6).
9. Each `provider.chat()` call is passed an `AbortSignal` wired to a supersession watcher (§5.1).
10. On completion: release the lease, persist + dispatch the reply, archive.

---

## 5. Supersession — the hard part

### 5.1 Detecting it

While a `provider.chat()` call is in flight, a watcher polls `inbound_epoch` every
`SUPERSEDE_POLL_MS`. If `inbound_epoch > epoch₀`, it aborts the request's `AbortSignal`.

`LlmRequest` gains an optional `signal?: AbortSignal`, threaded into both providers' `fetch()`
calls. This is the only change to the provider abstraction, and it is additive — an omitted signal
behaves exactly as today.

Polling, not LISTEN/NOTIFY, deliberately: the poll is one indexed primary-key read every couple of
seconds against a row already in cache, for the duration of an LLM call only. LISTEN/NOTIFY would
need a dedicated long-lived connection from a serverless route, which is a worse trade here.

### 5.2 Restarting

On abort, phase 2 loops back to step 7 — re-snapshot the epoch, rebuild the prompt (which now
includes the new messages), call again. The lease is **held across the restart**, and renewed each
iteration so a long burst can't let it expire underneath the owner.

Because the lease is held, any message that arrives during the restart took the step-5 fast path and
is already persisted — the rebuild picks it up. That is why step 5 can honestly report success.

### 5.3 Bounding it

A customer machine-gunning messages must not starve the turn forever. `MAX_TURN_SUPERSESSIONS = 3`:
after 3 restarts, the next call runs **without** a supersession watcher and is allowed to finish.
Anything that arrives after that point is handled by the *next* turn, which the trailing-message
sweep (§5.5) guarantees will happen.

### 5.4 Metering an aborted call

**Every call that returns is metered exactly as it is today** — the provider's own `usage` object,
straight into `logUsage`. Nothing in this document changes that, and that is the overwhelming
majority of calls. What follows applies *only* to a call we deliberately aborted mid-flight, where
no `usage` object exists because we hung up before the response completed.

An aborted call still consumed provider compute, and the two halves of its cost are knowably
different:

- **Prompt tokens are exactly knowable.** We built the prompt, so we have every token we sent, and
  the provider bills input the moment it accepts the request regardless of whether we hang up.
  Computing this is the same arithmetic the provider does — not a guess.
- **Completion tokens are genuinely unknown.** We hung up mid-generation. Could be 5 tokens, could
  be the `max_tokens` cap of 800.

The asymmetry matters less than the 4×-output-price rate table suggests, because our shape is large
prompts (cached prefix + catalogue + history) against small capped replies. **Input dominates real
cost on a typical turn, and input is the half we can know.**

**Decision: log prompt tokens computed exactly, and record the completion side as unknown — not as
zero.** `usage_logs.completion_tokens` is nullable for these rows, and a new
`usage_logs.superseded boolean not null default false` marks them. `estimateCostUsd` treats a null
completion count as zero *for the cost figure* (so the cap still sees the input spend it should),
while the marker keeps the row honest about why the output side is missing.

Rejected alternatives, and why:

- *Assume `max_tokens` for the completion.* Never under-reports, but systematically over-charges —
  a tenant could be pushed into a service-gating cap on spend they did not incur.
- *Assume an average completion length.* A fabricated number in a billing-adjacent table.
- *Stream, and count the partial completion that actually arrived.* The only **complete** fix: it
  removes the unknown entirely rather than bounding it. Deliberately deferred — it is a significant
  refactor of both providers plus the orchestrator's result handling (streaming combined with
  tool-calling is fiddly), and bundling it into this change would make both harder to review. This
  is the right eventual answer; see §12.

**Residual gap, bounded:** at most `MAX_TURN_SUPERSESSIONS` (3) abandoned completions per turn,
each ≤800 tokens at $0.60/M ⇒ **≈$0.0014 worst case per superseded turn**, against a $5 default
free-plan cap. And supersession itself is rare: it requires a message arriving *after* the 4s grace
window closed *and* while the model is still generating — most bursts are absorbed by the grace
window and never abort anything.

**Consequence to keep visible:** `usage_logs` now holds two kinds of row, fully-measured and
partially-estimated. Every cost query (`getTrailing30DayMasterCostUsd`, the admin cost dashboards)
sums them together. The `superseded` column is what stops that from being invisible — it makes the
real drift *measurable against live traffic* instead of trusted from this document's arithmetic, and
lets any query ask for measured-only spend when it needs to.

### 5.5 Trailing-message sweep — the safety net

Two windows exist where a message could otherwise sit persisted but unanswered:

- it arrived after the `MAX_TURN_SUPERSESSIONS` cap was hit;
- it arrived between the last epoch snapshot and lease release, on the final (unwatched) call.

Both are real and neither is exotic. The sweep closes them: **after releasing the lease**, re-read
`inbound_epoch`. If it moved past the epoch the completed turn actually covered, immediately
re-enter phase 2 (fresh lease claim) for one more turn. This is a loop, not a recursion, and is
itself bounded by `MAX_SWEEP_ROUNDS = 2` — beyond that the session is genuinely under sustained
load and the *next* inbound message's own turn will catch up.

### 5.6 Tool calls

`runTurn`'s tool loop runs up to `MAX_TOOL_ROUNDS` provider calls. **Supersession is only checked
between rounds, and only aborts before a tool has executed** — never mid-`executeTool`. Tools have
side effects (an order is placed, stock is decremented); aborting between the model requesting a
tool and the tool running is safe, but aborting *after* a tool ran and then restarting the whole
turn would re-run it. So: once any tool in a turn has executed, that turn runs to completion with
no further supersession, and the sweep (§5.5) handles the rest. Ordering-safety beats latency here.

---

## 6. Combining the messages

The combined user turn is built from every `role='user'` message newer than the most recent
`role='assistant'` message in the session, in chronological order.

Joined with newlines into a single user turn — **not** as N separate user messages. Consecutive
same-role turns are unusual for chat models and some providers reject them outright; one coherent
user turn is both safer and closer to how a human reads a burst.

Media rides as it does today: `imageUrls` from *this* batch are attached to the combined turn, and
the existing `RECENT_IMAGE_REATTACH_WINDOW_MINUTES` logic is unchanged.

---

## 7. Constants (`src/lib/constants.ts`)

```ts
export const BATCH_GRACE_MS = 4000;
export const SUPERSEDE_POLL_MS = 1500;
export const MAX_TURN_SUPERSESSIONS = 3;
export const MAX_SWEEP_ROUNDS = 2;
export const TURN_LEASE_TTL_SECONDS = 90;
```

`TURN_LEASE_TTL_SECONDS` must exceed a realistic worst-case turn (grace + up to
`MAX_TOOL_ROUNDS` provider calls + tool execution). It is renewed on every supersession restart, so
it bounds *crash* recovery, not normal duration.

`BATCH_GRACE_MS = 4000` is the one number worth tuning from real traffic: long enough to catch a
two-thumb burst, short enough that a lone "hi" doesn't feel dead. Start at 4s, revisit with data.

### Mirrored constants — a standing hazard

`MAX_MESSAGE_ATTEMPTS` and `QUEUE_VISIBILITY_TIMEOUT_SECONDS` are already duplicated in the Deno
worker because Deno can't import the Node constants file. `TURN_LEASE_TTL_SECONDS` does **not** need
mirroring (the worker never claims a lease itself), but note that
`QUEUE_VISIBILITY_TIMEOUT_SECONDS = 30` is now **shorter than a batched turn can run**. A turn that
takes longer than 30s leaves its pgmq row eligible for redelivery while still processing —
previously rare, now routine.

**This must be fixed as part of this work:** raise the visibility timeout to comfortably exceed
`TURN_LEASE_TTL_SECONDS` (120s), in both `src/lib/constants.ts` and the Deno worker. Without it,
duplicate processing becomes normal instead of exceptional — and the `webhook_events` status gate is
what would absorb it, which is defence-in-depth, not a licence to skip this.

---

## 8. What does NOT change

- The fast-ACK webhook contract: verify → dedupe → enqueue → 200. Untouched.
- `webhook_events` idempotency and the poison/`dead` state machine (docs/15 §3.2, §4).
- The handoff gate — a handed-over session still short-circuits before any of this.
- The website widget's synchronous behaviour.
- `promptBuilder` and the cache-prefix contract. The combined turn is still one user turn on the
  dynamic tail; the static prefix stays byte-identical.
- Free-plan daily-session and rolling-30-day cost caps (they gate phase 1 / early phase 2 as now).

---

## 9. Failure modes, explicitly

| scenario | outcome |
| --- | --- |
| Worker crashes mid-turn, lease held | Lease expires after TTL; pgmq redelivers; `webhook_events.status` gate prevents double *processing*, sweep catches unanswered messages. |
| Two workers, same session, simultaneously | `claim_session_turn` is atomic — exactly one wins; the loser archives its row having already persisted its message. |
| Customer sends 20 messages in 10s | Grace window absorbs the first cluster; up to 3 supersessions; then one reply goes out; sweep runs up to 2 more rounds. Bounded, always terminates. |
| Abort fires but the LLM already returned | The result is discarded before persist/dispatch. Wasted spend, no customer-visible effect. |
| New message lands between epoch read and lease release | §5.5 sweep. |
| Provider ignores `AbortSignal` | Call runs to completion; result discarded on return. Degrades to "wasted call", never to a wrong reply. |
| Tool already executed, new message arrives | No supersession (§5.6). Turn completes; sweep answers the new message next. |

---

## 10. Acceptance criteria

- [ ] Two messages sent ~1s apart produce **exactly one** reply that addresses both.
- [ ] A single message still replies, delayed by no more than `BATCH_GRACE_MS`.
- [ ] A message sent mid-LLM-call aborts that call and produces one combined reply, not two.
- [ ] A burst longer than `MAX_TURN_SUPERSESSIONS` still terminates and answers everything.
- [ ] Every inbound message appears in `chat_messages` regardless of turn outcome.
- [ ] A handed-over session is completely unaffected.
- [ ] The website widget is byte-for-byte unaffected.
- [ ] `pgmq` visibility timeout raised in both `constants.ts` and the Deno worker (§7).
- [ ] No tool is executed twice across a supersession restart.
- [ ] Concurrent workers on one session cannot both run a turn (`claim_session_turn` atomicity).
- [ ] A call that **returns** is metered from the provider's own `usage`, unchanged from today.
- [ ] A call that is **aborted** writes a `usage_logs` row with exact prompt tokens, null completion
      tokens, and `superseded = true`.

---

## 11. Build order

1. Migration `0039` — `chat_sessions` columns + `claim_/renew_/release_session_turn`;
   `usage_logs.superseded` + `completion_tokens` made nullable (§5.4). Hand to the owner to run.
2. `src/types/database.ts` — new columns + the three functions.
3. `constants.ts` — §7, including the visibility-timeout raise (+ Deno worker mirror).
4. `provider.ts` + both provider impls — thread `signal?: AbortSignal`.
5. `sessions.ts` — `claimTurn` / `renewTurn` / `releaseTurn` / `readEpoch`.
6. `messages.ts` — `persist` bumps `inbound_epoch`; `loadPendingUserMessages(sessionId)` for §6;
   `logUsage` accepts a superseded/partial row (§5.4).
7. `aiOrchestrator.ts` — phase 1/2 split, supersession loop, sweep.
8. Tests: `claim_session_turn` atomicity, the combine step, the supersession/sweep bounds.

---

## 12. Deferred: streaming

§5.4 bounds the metering gap; it does not close it. Streaming both providers would: with a streamed
response we hold the partial completion at the moment we abort, so the completion tokens become
*counted* rather than *unknown*, and `usage_logs` goes back to a single fully-measured kind of row.

Deferred deliberately, not forgotten — it is a substantial refactor of `openai.ts`, `openrouter.ts`,
and `runTurn`'s result handling (streaming alongside tool-calling is the fiddly part), and doing it
inside this change would make both harder to review. Revisit once the `superseded` column has real
traffic behind it and the true drift is a measured number rather than an estimate.
