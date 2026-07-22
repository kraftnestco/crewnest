# 18 — Ecosystem Hardening & Complementary Features  (Phase 3)

> **Phase 3, workstream 4 of 4.** The "perfect what we have" pass: concrete fixes for edge cases found
> by reading the *current* code, plus two complementary features that round out the existing ecosystem
> (rolling conversation memory; a real free-plan ceiling) and the one explicitly-requested addition
> (tenant self-service team management). Findings already owned by docs 15–17 are cross-referenced, not
> re-solved here.

---

## 1. Audit findings (from reading the live code this pass)

Severity: **H** = correctness/data/cost risk, **M** = quality/UX, **L** = hygiene.

| # | Finding | Sev | Owner |
|---|---------|-----|-------|
| 1 | `after()` dedupes **before** processing → a crashed AI turn loses the message permanently (Meta's retry is deduped away). | H | **doc 15** (pgmq) |
| 2 | `after()` loop is sequential under one 60 s budget → a burst drops later messages. | H | **doc 15** |
| 3 | In-memory rate limiter can't share state across serverless instances → widget abuse ceiling is porous. | H | **doc 15 §5** |
| 4 | `continueSession` reply > 24 h out fails Meta's window silently. | M | **doc 15 §6** |
| 5 | Storage (`order-media`) + Vault secrets are **not** reached by the DB cascade → orphaned customer media/secrets on delete. | H | **doc 17 §4** |
| 6 | **Long-session context loss**: `loadWindow` keeps only ~50 msgs / token budget; older context is silently dropped, no summary. | M | **§2 here** |
| 7 | **Free plan bounds only *new conversations/day*** — an existing free session has unbounded message volume/cost on the master key. | H | **§3 here** |
| 8 | `webhook_events` dedupe insert never sets `tenant_id` (column exists, always null) → weaker per-tenant observability. | L | §4 here |
| 9 | `unread_count` is never reset server-side (only ephemerally in the inbox UI) — pre-existing (memory). | L | §4 here |
| 10 | Alert-signal **blind spot during handoff**: once `is_human_handoff=true`, step 4 short-circuits the LLM, so a customer escalating *after* a human takeover never re-flags. | M | §4 here (documented + light mitigation) |
| 11 | Web `continueSession` reply is persisted but never pushed (widget already returned its response; no customer push channel). | L | §4 here (documented) |

Findings 1–5 are fully specified in docs 15/17; this doc owns **6–11**.

---

## 2. Complementary feature — rolling conversation memory  (finding #6)  **Stage U-mem**

doc-07 Phase 2 lists "conversation summarisation for long sessions" as a backlog item; it was never
built. Today `messages.loadWindow` fetches the last `WINDOW_FETCH_LIMIT=50` rows and trims to
`MEMORY_TOKEN_BUDGET` — so a customer 80 messages deep into planning a custom order silently loses the
front of the conversation (their name, the design agreed on page 1). This is a real coherence bug on
exactly the high-value long custom-order threads the product is for.

**Decision — a compact rolling summary, cache-safe:**

- `chat_sessions.summary text` + `chat_sessions.summary_through_message_at timestamptz` (new). The
  summary is a short running digest of everything *older* than the live window.
- When a turn's history would exceed the window (i.e. `loadWindow` had to drop rows), a **best-effort,
  off-hot-path** summarisation runs (in the pgmq worker's post-turn step, or `after()` for web):
  feed the dropped-off messages + the previous summary to a cheap model, produce an updated ≤`SUMMARY_
  TOKEN_CAP` (~250 tok) digest, store it. This is the same "best-effort secondary op, catch-and-log,
  never block the reply" convention as owner-notify.
- `promptBuilder.build` injects the summary as **one `system` note on the dynamic tail** (at
  `cachePrefixLength`, same seam as open-now/retrieval) — **never** in the cached prefix (it changes per
  turn). Prompt shape: `[static prefix] ++ [summary note] ++ [open-now] ++ [retrieval] ++ [window] ++
  [user]`. The static prefix stays byte-identical, so prompt-cache economics are untouched (the
  invariant doc-05/12 protect and doc-17 R1 pins).
- Net effect: long conversations stay coherent **and cheaper** (a 250-tok summary replaces thousands of
  dropped tokens). Gated by the same `MEMORY_TOKEN_BUDGET` logic — short conversations never pay for
  summarisation because nothing is dropped.

**`[OPUS]` note:** this touches the prompt assembly (a doc-08 `[OPUS]` area) but is a *purely additive
dynamic-tail injection* following the exact seam three prior features already use — consistent with how
Stage-M/N and the alert-signal line were added without a fresh Opus pass. Frozen here.

---

## 3. Complementary feature — a real free-plan ceiling  (finding #7)  **Stage U-cap**

The free plan (self-serve signup, migration 0025) currently caps only **new conversations per day**
(`FREE_PLAN_DAILY_SESSION_CAP` in `handleInboundMessage` step 2). An existing free conversation can send
unlimited messages, each a master-key LLM call — so a single chatty free tenant (or an abuser) can run
up real COGS with no ceiling. For a **worldwide** free tier this is the load-bearing safety valve.

**Decision — a monthly master-key spend/volume ceiling, enforced in the orchestrator:**

- `tenants` gains `free_monthly_cap_usd numeric` (platform default via constant; nullable override).
  Applies only to `plan='free'` **and** `used_byok=false` turns (a BYOK free tenant spends their own
  key — not our problem; don't cap them).
- Before generating (in `runTurn`, after resolving the key, before `provider.chat`): if
  `plan='free'` and not BYOK, read the tenant's month-to-date `sum(estimated_cost_usd)` from
  `usage_logs` (cheap, indexed `(tenant_id, created_at)`; cache within the turn). If over cap →
  **don't call the model**; reply with a friendly "monthly limit reached on the free plan — the business
  will follow up / upgrade to continue" (mirrors `FREE_PLAN_LIMIT_REACHED_TEXT`), set a
  `plan_status='cap_reached'` marker, and emit **one** agency + tenant `upgrade_request`/`system_alert`
  notification (transition-only, like alert-signal, so it doesn't spam every blocked turn).
- Interlocks with doc-17 §3.3 cost alerts (the *agency* early-warning) and doc-16 cost analytics (the
  *visibility*). Together: free tenants are bounded, the agency sees spend before the bill, and upgrade
  is the natural prompt — the commercial funnel the signup plan intended.

The **daily new-conversation cap stays** (it throttles breadth); this adds the **monthly cost cap**
(it throttles depth). Both are needed; neither replaces the other.

---

## 4. Hardening fixes  **Stage U-fix**

Small, targeted, no new subsystems:

- **#8 — webhook_events tenant_id.** When the webhook can resolve the tenant before enqueue (Meta
  destination is known at parse time), set `tenant_id` on the `webhook_events` insert. Folds into
  doc-15's webhook rewrite (Stage P2). Improves the poison/erasure/analytics joins.
- **#9 — unread_count server reset.** Add `sessions.markRead(sessionId)` (service-role) called when
  staff opens a session server-side (or a lightweight action from the inbox), zeroing `unread_count` so
  it's authoritative, not just an ephemeral client guess. One function + one call site.
- **#10 — during-handoff escalation (light mitigation).** The LLM is correctly skipped during handoff,
  so no *new* alert_signal is generated — but a customer's messages still persist. Add a **keyword-only,
  no-LLM** tripwire in the persist path (reuse the retired-but-simple frustration heuristic memory
  describes) that, on a clearly-escalating message while `is_human_handoff=true`, bumps an existing
  flagged session's notification once ("customer still escalating on a handed-over chat"). No LLM cost,
  no schema beyond reusing `alert_signal`. Explicitly a *heuristic backstop*, not a model call —
  disclosed as such, matching how the original heuristic was framed before the LLM signal replaced it.
- **#11 — web continuation (document).** A `continueSession` reply on a `platform='web'` session has no
  push channel (the widget already returned). Leave as a **documented limitation** (media/clarification
  overwhelmingly arrives on Meta channels, not the widget) unless/until the widget grows a poll/SSE
  reconnect — noted as a future enhancement, not a Phase-3 build. Ensure the reply is at least persisted
  and visible in staff's inbox (it already is).

---

## 5. Complementary feature — tenant self-service team management  **Stage V**

**The gap:** inviting a teammate only exists on the **agency** side (`admin/clients/[id]/invite/`). A
business that signed up through the public self-serve funnel has **no way to add its own staff** — it
must email the agency to do it manually. That's a bottleneck directly on the self-serve growth motion
the signup plan built. Everything needed to close it already exists at the data layer.

**Reuse (no new primitives):**
- `user_tenants (user_id, tenant_id, role)` + the `member_role` enum
  (`platform_admin | tenant_admin | tenant_agent`) already exist (migrations 0002/0003).
- RLS already admits a tenant member to their own tenant's data; `0018_tenant_self_serve_write`
  restricts tenant writes to `tenant_admin`. The role distinction is already enforced app-side
  (`dashboard/business/page.tsx`: agents get inbox+orders only).
- The agency invite action already handles the Supabase-auth invite email, the "already-registered →
  password-recovery link" path, and stale-invite resend (memory). **The tenant flow reuses this exact
  action, scoped to the caller's tenant.**

**Build — `app/dashboard/team/`:**
- List the tenant's members (name, email, role, status) — RLS-scoped, so it's automatically only their
  own team.
- **Invite** (email + role ∈ {`tenant_admin`, `tenant_agent`}) — reuse the agency invite action with the
  tenant bound **server-side from the caller's session**, never from the form (same identity-binding
  invariant as every tool: the server supplies `tenant_id`).
- **Change role** / **remove member**.
- **Guardrails (`[OPUS]`-adjacent, frozen):**
  - Only a `tenant_admin` reaches these actions (route + action gate); a `tenant_agent` gets no team UI.
  - A tenant admin can grant **only** `tenant_admin`/`tenant_agent` — **never** `platform_admin` (that's
    agency-only; enforced server-side, not just hidden in the UI).
  - **Last-admin lockout guard**: refuse to remove or downgrade the final `tenant_admin` of a tenant, so
    a business can't lock itself out.
  - A tenant admin can act **only** within their own tenant (RLS + server-bound tenant id).

This is mostly UI + one RLS-scoped reuse of an existing action + the three guardrails. No new table, no
new migration (the enum + `user_tenants` already cover it). It turns the three-tier role model from
"schema that exists" into "value a self-serve client can actually use," and it's the natural companion
to the analytics (doc 16) and account surfaces (doc 14) a client already has.

---

## 6. Schema & build order

No new migration is strictly required for §5. §2/§3/§4 need a small additive one:

**Migration `0032_hardening.sql`** — `chat_sessions.summary text`, `chat_sessions.summary_through_
message_at timestamptz` (§2), `tenants.free_monthly_cap_usd numeric` (§3). (`webhook_events.tenant_id`,
`unread_count`, `alert_signal`, `member_role`, `user_tenants` all already exist.) Additive.

Order: **U-fix** (#8–#11, cheapest, fold #8 into doc-15 P2) → **U-mem** (§2 summarisation) → **U-cap**
(§3 free ceiling) → **V** (team management, independent, can be built any time). Each gated by
`tsc --noEmit` + `npm run build` and, once doc-17 R4 lands, by CI.

**`[OPUS]` sign-off:** §2 (summary on the dynamic tail, cache-safe), §3 (monthly master-key cost ceiling
scoped to non-BYOK free tenants, transition-only notify), §4 (#10 heuristic-not-LLM backstop, #11
documented limitation), §5 (the three team-management guardrails) are **DECIDED & FROZEN**. Sonnet
builds U/V with no further Opus pass.

---

## 7. Acceptance criteria

- [ ] An 80-message custom-order thread still "remembers" the customer's name/design from message 1 via
      the rolling summary; the static cache prefix is byte-identical before and after a summary exists
      (doc-17 R1 test extended to cover it).
- [ ] A `plan='free'`, non-BYOK tenant that crosses `free_monthly_cap_usd` stops generating, gets the
      friendly limit reply, and produces exactly **one** agency+tenant notification (not one per turn);
      a BYOK free tenant is unaffected.
- [ ] `unread_count` reflects reality after staff opens a session (server-reset, not just UI).
- [ ] A customer escalating on a handed-over chat bumps the flag once via the no-LLM heuristic (no LLM
      call is made during handoff — proven by no new `usage_logs` row).
- [ ] A `tenant_admin` can invite an agent from `/dashboard/team`, change their role, and remove them —
      all scoped to their own tenant; cannot grant `platform_admin`; cannot remove the last admin; a
      `tenant_agent` never sees the team UI.
- [ ] `tsc --noEmit` + `npm run build` green; CI green; deployed.
