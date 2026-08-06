# 26 — Plan Tiers & Entitlements

The four-tier plan structure and, more importantly, **where each limit is actually enforced**.
Built 2026-08-06. Supersedes the three-tier pricing in docs/22 §4 and the free-plan-only caps in
docs/18 §3.

---

## 1. The tiers

| Plan | Price | Conversations/day | Messages per conversation | Channels | AI assistant |
|---|---|---|---|---|---|
| **Free** | $0 | 5 | **20** | **1** | — |
| **Starter** | $39 | 5 | Unlimited | All | — |
| **Growth** | $49 | **20** | Unlimited | All | **✓** |
| **Pro** | $79 | **Unlimited** | Unlimited | All | ✓ |

PKR prices for Safepay tenants (docs/25 §3.2): Starter Rs 11,000 · Growth Rs 14,000 · Pro Rs 22,000.

**What changed from the previous structure:** Starter went $29 → **$39**; **Growth ($49) is new**; the
daily conversation cap now applies to Starter and Growth (it used to be free-only); the free plan gains
a per-conversation message limit; channel limits and the AI assistant are now genuinely enforced.

---

## 2. `lib/entitlements.ts` is the single source of truth

Every limit lives in one `ENTITLEMENTS` table, read by enforcement code **and** by the plan cards.

**Why this module exists.** Before it, "Up to 5 customer conversations/day" was a hand-written string
on the plan card while `FREE_PLAN_DAILY_SESSION_CAP` was a separate constant in `lib/constants.ts` —
and **"One channel at a time" was marketing copy enforced nowhere at all.** Marketing copy and
enforcement living in different files is how a paywall quietly stops matching what customers were
sold. The limit bullets on the cards are now *derived* from `ENTITLEMENTS`, and
`services/demo/plans.test.ts` fails if a card ever advertises a number the code doesn't apply.

**`Infinity` means unlimited**, deliberately, not `null` — comparisons stay plain numbers and
`isLimited()` reads honestly at the call site.

**Unknown plans fall back to `free`.** A typo or a retired plan id must never silently grant unlimited
everything: under-serving is fixed by an upgrade, over-serving is revenue lost with no signal.

---

## 3. Where each limit is enforced

| Limit | Enforced in | Behaviour at the limit |
|---|---|---|
| Daily conversations | `aiOrchestrator.ts` step 2, via `sessions.findOrCreate` | New conversation refused with a polite message. **Existing conversations are unaffected** — they were counted on the day they started. |
| Messages per conversation | `aiOrchestrator.ts` step 5a | AI stops replying; conversation **hands off to a human**, owner notified. |
| Channels | `dashboard/actions.ts` `requestPlatformSetupAction` | Request refused with an upgrade prompt. |
| AI assistant (Copilot) | `dashboard/business/copilot-actions.ts` `requireTenantAdmin` | All three copilot actions refused; Home shows an upgrade card instead. |

### 3.1 Three deliberate choices in how these fail

**The message-length limit hands off rather than just refusing.** The customer always keeps a path to
a human, and the owner sees a conversation waiting rather than a silently dead thread. It uses a new
`handoff_cause = 'length_limit'`, so the analytics handoff breakdown (docs/16) separates it from a
genuine escalation.

**The length check runs AFTER the inbound message is persisted.** The customer's words are saved and
visible in the inbox no matter what: the limit stops the AI from *replying*, it never drops input.

**Channels are enforced at REQUEST time, not on inbound traffic.** A tenant who already has channels
connected must never have real customer messages silently dropped because their plan changed. The
check counts already-connected channels so the limit applies to the resulting total, and ignores
re-requests of channels already live.

### 3.2 Copilot gating is server-side, not just hidden UI

The plan check sits inside the shared `requireTenantAdmin` gate that **all three** copilot server
actions route through, so a hand-crafted request from a lower-tier tenant is refused too. Hiding a
button is not access control.

**Platform admins bypass the plan check** — agency staff support clients on every tier, and that
access is a support tool, not a purchased entitlement.

---

## 4. Adding a tier without breaking checkout

Adding `growth` surfaced a class of bug worth recording: **hardcoded two-plan checks scattered across
the codebase**, each of which failed silently rather than loudly.

- `stripe.ts` / `safepay.ts` price lookup — was a ternary; now an **exhaustive `Record<PaidPlanId, …>`**,
  so a new tier without a configured price is a *compile* error, not a failed checkout.
- **Stripe webhook** rejected any plan id outside `starter|pro` — a Growth customer would have paid
  and stayed on their old plan, with only a log line.
- **Signup** (`provision-actions.ts`) had a local `PLAN_IDS` copy that silently downgraded unknown
  tiers to `free` — user picks Growth, pays nothing, lands on free, no error anywhere.
- **`complete-client.tsx`** had a private `isPaidPlanId` duplicate that would have skipped checkout.
- Both webhooks named the plan with `id === 'starter' ? 'Starter' : 'Pro'`, which tells a Growth
  subscriber they're on Pro. Now `planDisplayName()`.
- Pricing grids were `grid-cols-3` for three plans; now 2-up/4-up.

**The lesson:** a plan id is an allow-list, and every copy of that allow-list is a place a new tier
can silently vanish. They are all imports from `lib/entitlements.ts` now. The runtime guard in
`createCheckoutSessionAction` matters too — `PaidPlanId` is erased at runtime and the value arrives
from the client.

### 4.1 The tier change that had no code path at all (found on audit)

`handleSubscriptionUpdated` returned early unless the status was `past_due`/`unpaid`, so **a tier
change made through Stripe's Customer Portal was ignored entirely.** The portal's own doc comment in
`services/stripe.ts` advertised "self-serve plan changes", but nothing mapped a changed Price back to
a plan. A Starter customer upgrading to Growth in the portal would be **charged $49 and stay on
Starter**; a downgrade would leave them over-entitled.

Nearly invisible with two plans — with four it is a normal path.

Fixed with `planForPriceId()` (the reverse of `priceIdForPlan`) plus `syncPlanFromSubscription()` in
the webhook, which:
- writes and notifies **only on a genuine tier change** (`subscription.updated` also fires for
  renewals, card updates, and dunning);
- **leaves an unrecognised Price alone** rather than downgrading — a Price created by hand in the
  Stripe dashboard must never silently strip a paying tenant's plan. It logs instead.

**Safepay needs no equivalent.** It has no hosted portal, every `ACTIVE` event carries its own
`reference` with the plan, and a tier change there is cancel-and-resubscribe — i.e. a fresh checkout
with a fresh reference.

---

## 5. Schema (`0046_plan_tiers_and_length_handoff.sql`)

Additive; no data migration.

- `chat_sessions.handoff_cause` check constraint extended with `'length_limit'`. Required — 0030
  constrained it to a closed set, so the write would otherwise fail.
- Partial index `chat_messages (session_id) where role = 'user'`, because counting a session's
  customer messages is now on the hot path for every inbound turn on a length-limited plan.

**No check constraint was added to `tenants.plan`** — it has been an app-validated allow-list since
0025 (like `business_type`/`media_handling`), and adding one here would be an unrelated behaviour
change.

**Existing `starter` tenants keep their plan id** and simply move to the new $39 price at renewal.
Nothing is backfilled and no live subscription is touched.

---

## 6. Environment

Two new vars, same fail-loud posture as the existing ones:

| Var | Note |
|---|---|
| `STRIPE_PRICE_GROWTH` | Stripe Price id for Growth ($49). |
| `SAFEPAY_PLAN_GROWTH` | Safepay Plan id for Growth (Rs 14,000). |

**Repricing Starter to $39 is not a code-only change.** The Stripe Price and the Safepay Plan are
where the amount actually lives — `plans.ts` only *displays* it. Changing one without the other means
the card advertises a price the customer is not charged.

---

## 7. Acceptance criteria

- [x] Typecheck, lint (0 errors), 158 tests, `npm run build` all green.
- [x] 28 new unit tests pinning the advertised limits, card/enforcement agreement, and the
      price→plan reverse mapping.
- [x] Higher tiers can never have a *lower* conversation allowance (pinned by test).
- [x] Unknown plan ids resolve to free, never to a paid tier (pinned by test).
- [x] **Migration `0046` applied and verified 2026-08-06** — `length_limit` accepted, all four
      pre-existing causes still valid (constraint not narrowed), a bogus cause still rejected
      (`23514`).
- [x] Both providers exercised across all three paid tiers: distinct price/plan ids, reference
      round-trip, webhook plan gate, and — for Safepay — that a forged `reference` claiming a higher
      tier fails signature verification.
- [ ] A free tenant hits 20 messages and is handed off, with the owner notified.
- [ ] A free tenant is refused a second channel; a Starter tenant is not.
- [ ] A Starter owner cannot reach the Copilot; a Growth owner can.
- [ ] A real Growth checkout completes on both providers (blocked on the billing accounts, §4d).

---

## 8. Two live consequences to expect

**1. Two existing conversations are already over the 20-message limit.** Verified against the live
database on 2026-08-06: of 8 free-plan conversations, 2 exceed 20 customer messages and will hand off
to a human on their next inbound message. This is the feature behaving correctly, but it will look
abrupt — including on the KraftNest Automations test tenant.

**2. Gating the Copilot at Growth removes it from every current owner.** All 3 live tenants are on
`free`, and the Copilot is available to them today. After this change they see an upgrade card
instead. This was a deliberate product decision, not an accident — if these accounts should keep
access, grandfather them explicitly rather than loosening the gate.
