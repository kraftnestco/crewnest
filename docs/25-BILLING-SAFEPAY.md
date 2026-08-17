# 25 — Local Billing (Safepay, Pakistan)

Adds a **second SaaS-billing provider** alongside Stripe (docs/22), so Pakistani tenants can pay for
ClerkNest itself. Built 2026-08-06.

> **⏸️ STATUS: ON HOLD (2026-08-06).** Code-complete, migration `0045` applied and verified, but
> **no payment has ever been processed** — blocked on creating real Stripe *and* Safepay merchant
> accounts. Paused by decision, not by anything unfinished in the code. §8's unchecked criteria are the
> resume point; §9 (and handoff.md §4d.1) is the ordered ops checklist. **Do not "finish" this by
> writing more code.**

> **Not to be confused with docs/11.** Doc 11 is a *tenant's customer* paying for an order (COD /
> manual transfer / gateway). This doc is **ClerkNest charging its tenants** for the product. Different
> money, different tables, different providers.

---

## 1. Why a second provider at all

**Stripe does not onboard Pakistan-based merchants.** You cannot register a Pakistani business and
receive Stripe payouts, so there is no configuration of docs/22 that can charge a Pakistani tenant.
That is the whole reason this exists — not preference, not fees.

**Safepay was chosen** over PayFast and over direct JazzCash/Easypaisa integration because it is the
only local option exposing real *subscription* primitives (`createSubscription`, `subscription.cancel/
pause/resume`, signed webhooks). PayFast publishes no recurring API, and JazzCash/Easypaisa merchant
APIs are per-transaction request/approve flows — a customer approves each charge, which is wrong for a
monthly subscription and would produce involuntary churn every cycle. Safepay reaches both wallets
anyway, as funding methods behind one integration.

---

## 2. Routing: by country, never by tenant choice

`services/billing.ts` is the single place that answers "which provider charges this tenant?".

```
providerForTenant(tenant):
  stored tenant.billingProvider, if recognised   ← authoritative once subscribed
  else providerForCountry(tenant.billingCountry) ← 'PK' => safepay, else stripe
```

**Why not let the tenant pick.** Stripe cannot serve Pakistani merchants and Safepay cannot practically
serve international cards. A tenant choosing the wrong one gets a card decline they cannot self-diagnose
and will open a support ticket for. The country field is a fact; the provider is derived from it.

**Why stored beats derived.** Once a tenant has a live subscription, the provider holding it is
authoritative and must not change under them because someone edited a country field later — that would
orphan a subscription that is *still charging them*. Pinned by test in `billing.test.ts`.

### 2.1 It is a router, not a `BillingProvider` interface

Deliberately. The two providers are **not substitutable** (§3), so a uniform interface would have had
to either invent a fake portal for Safepay or drop the real one from Stripe. An honest router that
admits the difference beats an abstraction that lies about it. Only `createCheckout` is genuinely
common, and only that is unified.

---

## 3. Three ways Safepay is NOT Stripe

These shaped the code more than anything else. Verified against `@sfpy/node-sdk@3.0.2`'s actual type
definitions, not documentation prose.

### 3.1 No customer object
Safepay has no `customers.create`, so there is **no equivalent of `ensureStripeCustomer`** and no
metadata bag. Identity round-trips entirely through our own `reference` string:

```
reference = "<tenantId>:<planId>"     e.g. "cc3f2475-…-3a582a496fa6:starter"
```

This string is the **only** link from a webhook back to a tenant. `parseReference` refuses anything
malformed rather than guessing a tier — a bug here means paid-but-not-upgraded, so it is pinned by
tests.

### 3.2 The plan carries the price — so prices are fixed PKR, not converted USD

`checkout.createSubscription` accepts **only** `{ planId, reference, redirectUrl, cancelUrl }`. Amount,
currency and interval all live on the plan in Safepay's merchant dashboard. There is **no per-checkout
amount parameter**.

**Consequence, and a reversed decision:** converting the USD price at checkout time is *not
expressible* on this API. Safepay bills a fixed recurring amount, so even if we computed a PKR figure
we would have nowhere to send it, and the rate would be frozen at subscribe time anyway — two tenants
subscribing a month apart would pay permanently different amounts, neither tracking $29.

So `PAYWALL_PLANS` carries an explicit `pricePkr` per plan. **Repricing is a two-part change**: edit the
plan in Safepay's dashboard AND update `pricePkr`. They are two halves of one change; changing only one
makes the UI lie about what is charged.

`SAFEPAY_USD_TO_PKR` is retained only to sanity-check drift between the two price points. It is an env
var rather than a live FX call so a rate-feed outage can never block a checkout and a past charge stays
reproducible when reconciling.

### 3.3 No hosted customer portal
Stripe's `billingPortal` has no counterpart. Safepay exposes cancel/pause/resume as API calls, so
"Manage billing" for a Safepay tenant is an **in-app cancel action**, not an external link. The billing
panel branches on this; `createPortalLinkAction` refuses for Safepay tenants rather than throwing an
opaque error.

Cancellation **requests** cancellation only — the downgrade still lands via the webhook, preserving the
single-writer rule (§4) so a failed cancel can never leave a tenant downgraded while still being charged.

---

## 4. The webhook is the only writer

`api/webhooks/safepay/route.ts`, mirroring the Stripe webhook's discipline exactly:

1. Read the **raw body** before parsing (the HMAC is over exact bytes).
2. Verify `x-sfpy-signature` — HMAC-SHA512 over `JSON.stringify(body.data)` with the webhook secret.
   Bad or missing signature → **401**.
3. **Idempotency**: insert into `safepay_events` keyed on the provider's tracker id. The insert **is**
   the gate — `23505` means already handled → ACK 200 and stop.
4. Map status → action:
   - `ACTIVE` / `TRAILING` → set `plan`, clear `plan_status`, persist subscription ids + charged amount
   - `PAST_DUE` / `UNPAID` / `INCOMPLETE` → `plan_status='payment_failed'`, keep the tier, notify once
   - `CANCELED` / `ENDED` / `INCOMPLETE_EXPIRED` → downgrade to free, clear Safepay ids
5. Anything else is ignored — Safepay emits more statuses than we act on.

The checkout redirect is **optimistic UI only**, never a source of truth — same reason documented on
the Stripe webhook and in docs/15 §1.

The stored `safepay_amount_minor` makes the recurring charge auditable: since the plan's amount is
fixed, this records what the tenant will actually be billed each cycle.

---

## 5. Schema (`0045_safepay_billing.sql`)

```
tenants.billing_provider        text not null default 'stripe'  -- check: stripe|safepay
tenants.billing_country         text                            -- ISO-3166-1 alpha-2
tenants.safepay_customer_id     text
tenants.safepay_subscription_id text
tenants.safepay_amount_minor    bigint    -- PKR minor units, locked at subscribe time
tenants.safepay_currency        text

safepay_events (id pk, type, processed_at)  -- RLS on, no policies, service-role only
```

Additive; `billing_provider` defaults to `'stripe'` so every existing tenant keeps current behaviour
with no backfill. `safepay_events` mirrors `stripe_events`/`webhook_events` posture exactly.

---

## 6. Environment

| Var | Note |
|---|---|
| `SAFEPAY_SECRET_KEY` | API key from the Safepay dashboard. |
| `SAFEPAY_WEBHOOK_SECRET` | Webhook signing secret. Also fed to the SDK's `v1Secret`. |
| `SAFEPAY_PLAN_STARTER` | Plan id (`plan_…`) for the Starter tier. |
| `SAFEPAY_PLAN_PRO` | Plan id for the Pro tier. |
| `SAFEPAY_ENVIRONMENT` | `sandbox` (default) or `production`. **Defaults to sandbox so a half-configured deploy can never take real money.** |
| `SAFEPAY_USD_TO_PKR` | Display/drift-check only (§3.2). Default 278. |

Same **fail-loud** posture as Stripe (docs/22 §4): unset ⇒ checkout refuses with a clear error rather
than silently no-op-ing. A paywall that appears to work but never charges is the worse failure.

`getSafepayClient()` additionally refuses when the *webhook* secret is missing, even though checkout
alone would work without it — a subscription created with no verifiable webhook path would take money
we could never confirm, leaving the tenant paid-but-not-upgraded.

---

## 7. Dependency note

`@sfpy/node-sdk@3.0.2` depends on `axios@^0.26.0`, which carries a large number of high-severity
advisories. `package.json` pins `overrides: { axios: "^1.19.0" }`. Verified after the override: client
construction, and both signature verifiers accepting a valid HMAC and rejecting an invalid one.

**Re-check this on any SDK upgrade** — if a future version depends on axios ≥1 directly the override
can be dropped, and if it pins something incompatible the override must be re-validated.

---

## 8. Acceptance criteria

- [x] Typecheck, lint, full test suite, `npm run build` all green.
- [x] Provider routing + reference round-trip unit-tested (11 tests).
- [x] Webhook signature verification exercised against a real HMAC (valid accepted, invalid rejected).
- [ ] **A real sandbox subscription completes end to end** — checkout → webhook → `plan` flips.
- [ ] A duplicate webhook delivery does not double-apply (ledger gate).
- [ ] A cancellation downgrades to free via the webhook.
- [ ] A Stripe tenant is entirely unaffected — regression check after `0045` is applied.

The unchecked items need a real Safepay sandbox account (§9); none could be exercised without one.

---

## 9. Still needed (ops, not code)

1. **Create a Safepay merchant account** and complete business verification (registration, bank proof,
   ID). Sandbox is enough to start.
2. **Create two recurring plans** in the dashboard — Starter and Pro — at the fixed PKR amounts that
   match `pricePkr` in `services/demo/plans.ts`. Note their `plan_…` ids.
3. **Register the webhook endpoint**: `https://<domain>/api/webhooks/safepay`.
4. **Set the six env vars** in `.env.local` and Vercel (Production + Preview). Keep
   `SAFEPAY_ENVIRONMENT=sandbox` until a real end-to-end test passes.
5. **Apply migration `0045`** by hand in the Supabase SQL editor (migrations do not auto-apply — see
   the drift warning in handoff.md §5).
6. **Capture `billing_country` at signup.** The column exists and routing reads it, but the signup flow
   does not yet collect it — until it does, every new tenant defaults to Stripe. This is the one gap
   between "built" and "a Pakistani tenant can actually self-serve."
