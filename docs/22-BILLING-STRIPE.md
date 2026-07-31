# 22 — Billing (Stripe)  (backlog 4d)

> **`[OPUS]` design pass, 2026-07-27.** handoff.md §4d: no Stripe/billing code exists anywhere; paid
> plans are provisioned manually. Provider decision (this session, with the user): **Stripe** — the
> tenant base is global/mixed, not Pakistan-first, and no existing account favors either provider, so
> Stripe's international reach + Vercel's provisioned-integration path win over a local PK gateway.
> This doc freezes the design; Sonnet builds against it. **Do not re-litigate `[OPUS]`-marked
> decisions without a new Opus pass.**
>
> **Don't confuse this with customer payments.** A tenant's own customers paying THEM (bank
> transfer + payment-proof upload, docs/11) is already built and untouched by this doc. This doc is
> about charging **tenants** for CrewNest itself.

---

## 1. What already exists — reuse, don't rebuild

- **`tenants.plan`** (`'free' | 'starter' | 'pro'`, migration 0025) and **`tenants.plan_status`**
  (free-form text: `null`, `'pending_upgrade'`, `'cap_reached'` today) — the spine this bolts onto.
- **`PAYWALL_PLANS`** (`services/demo/plans.ts`) — real prices already chosen: Free $0, Starter
  $29/mo, Pro $79/mo. This doc does not re-price; Stripe Products/Prices are created to MATCH these,
  not invent new ones.
- **`paywall-modal.tsx`** — the plan-selection UI itself needs NO change: it already just hands the
  chosen `planId` off to signup, and no tenant/Stripe Customer exists yet at that point in the demo
  funnel (the visitor is still anonymous). The real integration point is one step later —
  **`(auth)/signup/complete/complete-client.tsx`**, which today lands a paid-plan signup on a "we'll
  reach out" holding message after `provisionTenantAction` stamps `plan_status='pending_upgrade'`.
  That holding step is replaced with a real Checkout redirect; the `pending_upgrade` stamp still
  happens first and is only cleared by the webhook once payment actually completes, so an abandoned
  checkout correctly stays pending rather than silently landing on a free (or worse, a live-but-
  unpaid) tenant.
- **`usage_logs`** (`estimated_cost_usd`, `used_byok`, per-turn) — already the metering source the
  free-plan cap reads (`messages.getTrailing30DayMasterCostUsd`). Same table feeds Stripe usage
  reporting (§3).
- **Off-limits fields are ALREADY enforced**: no Copilot tool exists for `plan`/`plan_status`/
  billing fields, and the appliers hard-reject them (verified multiple times this session, e.g.
  docs/19 O5, docs/20 §2.6). **This doc does not change that.** Stripe writes to `plan`/`plan_status`
  exclusively through the webhook handler (§4) — never through any Copilot, never through user-facing
  server actions directly setting the column.
- **No admin UI currently edits `plan` at all** — confirmed by search; today's "manual provisioning"
  is a direct database edit by whoever operates Supabase. This doc does not need to reconcile with an
  existing plan-editing screen.

---

## 2. Decisions  `[OPUS]` — DECIDED

### 2.1 Subscription model, not metered usage-based pricing — DECIDED

`docs/07-PHASES.md`'s original Phase-2 sketch said "Stripe subscriptions + usage metering... plan
limits/quotas." Re-scoped here: **flat-fee subscriptions per `PAYWALL_PLANS` tier, no per-token
metered billing.** Usage still matters — `usage_logs` still feeds the FREE plan's cost ceiling
(unchanged, already shipped) and now ALSO feeds a **soft overage flag** on paid plans (§2.4) — but
customers are never billed a variable amount per API call. Reasons:

- Flat-fee is simpler for both sides to reason about — a small-business owner in Pakistan or
  elsewhere can budget $29/mo; "your bill depends on how many tokens your AI used" is a support-ticket
  generator for a non-technical audience.
- Stripe's metered-billing primitives (usage records, billing thresholds) are real complexity for a
  V1 with three flat tiers. Nothing here forecloses adding metered add-ons later — it's additive.
- The free plan's existing hard cost ceiling ALREADY proves the team is comfortable capping cost
  without needing to charge for overage — the same instinct applies to paid tiers (§2.4: warn, don't
  silently overbill).

### 2.2 Stripe Checkout + Customer Portal, not custom card forms — DECIDED

Use **Stripe Checkout** (hosted, Stripe-hosted payment page) for the initial subscribe, and the
**Stripe Customer Portal** (hosted, Stripe-hosted) for self-serve plan changes/cancellation/payment
method updates. **No custom card-entry UI is built in this app, ever.**

- Zero PCI scope: card data never touches this codebase's servers or client bundle. This is the same
  "zero secrets on the client" instinct CLAUDE.md already states for LLM/Meta keys, applied to
  payment data.
- Both are genuinely hosted redirects — CrewNest links out, Stripe handles the form, Stripe redirects
  back. This matches the existing pattern of `sendText`/`sendTemplate` treating Meta as the system of
  record for delivery rather than reimplementing messaging UI.
- **Provisioning path**: per handoff.md's own note, prefer the Vercel Marketplace's Stripe
  integration for provisioning the account/keys over hand-rolled dashboard signup, when available at
  build time. This is an ops choice at setup time, not a code-path branch — the app code talks to
  Stripe via its normal SDK/webhooks regardless of how the account was provisioned.

### 2.3 Webhook-driven state, one source of truth — DECIDED

**Stripe's webhook is the ONLY writer of `tenants.plan` and `tenants.plan_status` once billing is
live.** The flow:

1. Tenant clicks "Choose Starter" in the (updated) paywall UI → server action creates a Stripe
   Checkout Session for that tenant, redirects to Stripe.
2. Stripe handles payment, redirects back to a `/dashboard/billing/success` page (optimistic UI only
   — does NOT flip `plan` itself; see next point).
3. Stripe fires `checkout.session.completed` (and later `customer.subscription.updated`/`.deleted`)
   to a new webhook route. **That webhook is what actually sets `tenants.plan` and clears
   `plan_status`.**

This mirrors the Meta webhook's own hard-won lesson from this session's Stage P work
(docs/15 §1): trusting an optimistic client-side redirect as the source of truth is exactly the
silent-failure shape that bit the Meta `after()` pipeline. The webhook is the durable, replayable
source of truth; the redirect page is UI polish that says "please wait" and polls/refreshes.

**Idempotency**: same posture as `webhook_events` (docs/15 §3.1) — a `stripe_events` ledger table
(§5) keyed on Stripe's own `event.id`, checked before processing, so a Stripe retry (Stripe retries
undelivered webhooks for up to 3 days) never double-applies a plan change.

### 2.4 Payment failure / overage handling — DECIDED

- **A failed renewal charge**: Stripe's own **Smart Retries** handle re-attempting the card
  automatically (their default dunning behavior) over about 2 weeks. On the FINAL failure
  (`customer.subscription.deleted` or the subscription's status moving to `unpaid`/`canceled`), the
  webhook sets `plan_status='payment_failed'` (a new status value, alongside the existing
  `'pending_upgrade'`/`'cap_reached'`) and **notifies both audiences** via the existing
  `notifyBoth()` — mirroring exactly how the free-plan cost-cap notifies today. The tenant is NOT
  immediately downgraded to free or cut off — a grace read from `plan_status` in the UI shows a
  "payment failed, update your card" banner, matching the existing paywall-modal's tone.
- **Paid-plan usage tracking is a soft signal, not a hard cap — and it ALREADY EXISTS.** Discovered
  while implementing, not designed fresh: `services/maintenance.ts#scanCostAlerts` (docs/17 §3,
  Stage S3) already sums each tenant's daily `usage_logs` spend and fires an agency-only
  `system_alert` when it crosses that tenant's own `tenants.daily_cost_alert_usd` — a nullable,
  per-tenant, admin-set threshold, checked once a day by the existing maintenance cron. This is
  precisely the "soft overage alert" this section originally called for as new work. **No new code
  for this — set `daily_cost_alert_usd` on paid tenants (an ops/admin step, not a code path) rather
  than building a second, billing-specific alert system next to an identical one that already runs.**
  Unlike the free plan (hard ceiling, turns are blocked), a paid tenant crossing this never blocks a
  customer-facing turn — it only tells the agency, so they can reach out about an upsell or a genuine
  cost anomaly.
- **Downgrade/cancellation** (via the Customer Portal) fires `customer.subscription.deleted` →
  webhook sets `plan='free'`, clears `plan_status`. The tenant immediately becomes subject to the
  EXISTING free-plan caps (already shipped, unchanged) — no special "grace period on downgrade"
  logic; simplest correct behavior, and matches how the free caps already work for a brand-new
  signup.

### 2.5 Off-limits fields — reaffirmed, not re-decided

No change to the standing rule (CLAUDE.md, reaffirmed across docs/19, docs/20 this session):
`plan`, `plan_status`, `*_secret_id`, `is_active`, `llm_provider`, `llm_model` remain untouchable by
any Copilot tool. The Stripe webhook route is server-only, signature-verified, and is the sole
non-manual writer of `plan`/`plan_status` — it is infrastructure, not a Copilot action, and was
never in scope for that restriction to begin with (the restriction is about the AI/Copilot surface,
not about billing infra).

---

## 3. Usage metering — fully reused, zero new code

No new usage-tracking code, and no new alert pipeline either (§2.4 corrects this doc's original
plan): `services/maintenance.ts#scanCostAlerts` (docs/17 §3, Stage S3) already sums per-tenant daily
`usage_logs` spend and fires an agency `system_alert` when it crosses that tenant's own
`daily_cost_alert_usd`. The soft-overage signal for paid tenants IS that existing mechanism — set
the threshold, nothing to build. No Stripe **usage record** API calls either way — this is an
internal signal, not metered billing (§2.1).

---

## 4. Components

| File | Role |
|---|---|
| `supabase/migrations/0038_billing.sql` | `stripe_events` ledger (§2.3), `tenants.stripe_customer_id`, `tenants.stripe_subscription_id`, widen `plan_status` check to add `'payment_failed'` |
| `src/services/stripe.ts` | `server-only`. Thin SDK wrapper: create Checkout Session, create/return a Customer Portal link |
| `src/app/api/webhooks/stripe/route.ts` | Signature-verified (raw body, like the Meta webhook), idempotent via `stripe_events`, the ONLY writer of `plan`/`plan_status` post-launch |
| `src/app/dashboard/billing/actions.ts` | `'use server'`: `createCheckoutSessionAction`, `createPortalLinkAction` — both tenant-admin-gated, mirroring `requireTenantAdmin` in `copilot-actions.ts` |
| `src/app/dashboard/billing/page.tsx` | Shows current plan/status, a "Manage billing" link to the Portal, and the `payment_failed` banner (§2.4) |
| `src/app/(auth)/signup/complete/complete-client.tsx` | Updated: a `pending_upgrade` paid signup now redirects to a real Checkout Session instead of a holding message (see §1's reuse note) |
| `src/lib/constants.ts` | Stripe Price ID ↔ `PAYWALL_PLANS.id` mapping |

**Env** (new, all required once this ships — billing has no meaningful "unconfigured, no-op" mode
the way Resend/push do, since it IS the checkout flow): `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (unused server-side but conventional
to keep alongside), `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`.

---

## 5. Schema — migration `0038_billing.sql`

`plan_status` had NO database check constraint before this migration — 0025's own comment says it
was "app-validated" only (TypeScript-side). This migration adds the first real one, including the
two values already in production use (`pending_upgrade`, `cap_reached`) plus the new
`'payment_failed'` (§2.4).

```sql
alter table public.tenants
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text;

alter table public.tenants drop constraint if exists tenants_plan_status_check;
alter table public.tenants add constraint tenants_plan_status_check
  check (plan_status is null or plan_status in ('pending_upgrade', 'cap_reached', 'payment_failed'));

create table if not exists public.stripe_events (
  id           text primary key,  -- Stripe's own event.id — the idempotency key
  type         text not null,
  processed_at timestamptz not null default now()
);
-- service-role only, no RLS-authenticated access — same posture as webhook_events.
```

---

## 6. Acceptance criteria

- [ ] Choosing "Starter" or "Pro" redirects to a real Stripe Checkout Session for that exact price.
- [ ] Completing checkout → `checkout.session.completed` webhook fires → `tenants.plan` flips to the
      chosen tier and `plan_status` clears, WITHOUT the client-side redirect page ever writing to the
      database itself.
- [ ] Replaying the identical Stripe webhook event twice → applied once (idempotency, `stripe_events`).
- [ ] A `customer.subscription.deleted` event (cancel or final payment failure) sets `plan='free'`
      and the tenant is immediately subject to the existing free-plan caps.
- [ ] A final payment failure sets `plan_status='payment_failed'` and notifies both agency + tenant.
- [ ] No Copilot (owner or admin) can propose or apply any change to `plan`, `plan_status`,
      `stripe_customer_id`, or `stripe_subscription_id` — verified by grep, same as every prior
      off-limits-field check this session.
- [ ] `STRIPE_SECRET_KEY` never appears in client bundle or logs.
- [ ] `tsc --noEmit`, `eslint`, `vitest`, `npm run build` all green.
