# 11 — Payment Collection & Order Lifecycle (edit / cancel) (Phase 2)

This is the design for **collecting payment** and for letting a customer **change or cancel** an order
they already placed — the two things standing between "the AI takes orders" and "the AI runs the storefront."

It builds directly on the order-taker from [`09-ORDERS-AND-TOOLS.md`](./09-ORDERS-AND-TOOLS.md) and the
custom-orders / media / approval work in
[`10-CUSTOM-ORDERS-MEDIA-AND-INTAKE.md`](./10-CUSTOM-ORDERS-MEDIA-AND-INTAKE.md). It reuses their seams
rather than inventing new ones: the same `create_order` identity invariant, the same service-role write
boundary, the same `order-media` private bucket, the same `webhook_events` idempotency ledger, and the
same Vault secret-reference pattern already used for LLM/Meta keys.

**Designed in an Opus session (2026-07-16).** Everything below is **additive and backward-compatible**: a
tenant with `payments_enabled = false` behaves exactly as the doc-09/doc-10 order-taker. Implementation is
mechanical for Sonnet, stage by stage — **except** the sub-steps tagged `[OPUS]` in §11, which must pause
for an Opus pass before they are built.

> **Market reality this design is shaped by.** ClerkNest's first clients are Pakistani SMBs. There, the
> dominant payment reality is **Cash on Delivery**, then **manual transfer** (JazzCash / Easypaisa / bank
> account, customer sends a screenshot of the receipt), and only then **hosted gateways** (Safepay,
> PayFast — Stripe is not available in PK). So the design is **tiered**: COD and manual-transfer ship
> first with **zero external integration**, and the gateway is a *pluggable provider* added last. We do
> **not** start with "integrate Stripe."

---

## 1. Scope, staging & locked decisions

Four independently shippable stages, in ship order. **Stage I (order edit/cancel) is independent of
payment entirely** and can ship first. **Stage J delivers real payment value — COD + manual transfer —
with no new external calls.** The hosted gateway (L) layers on last.

| Stage | What | Depends on | Model |
|-------|------|-----------|-------|
| **I** | **Order edit & cancel** — session-scoped `edit_order` / `cancel_order` tools, state-transition guards, approval re-open | doc 09 A+B, doc 10 E3 | `[SONNET]` (this doc) |
| **J** | **Payment foundations** — payment schema (orthogonal `payment_status`), tenant payment config, **COD + manual-transfer**, `## PAYMENT` prompt block, dashboard payment state + owner "mark paid" | doc 09 A+B | `[SONNET]`, one `[OPUS]` gate: **J1** (§11) |
| **K** | **Payment proof media** — customer uploads a receipt screenshot → `awaiting_verification`; owner verify/reject in dashboard | J + doc 10 **F** (media pipeline) + **E4** (bucket RLS) | `[SONNET]` |
| **L** | **Hosted gateway** — pluggable `PaymentProvider` (payment link the AI shares) + a signed payment webhook that confirms the charge | J | `[OPUS]` design of the provider interface + webhook + trusted-amount rule first (§6) |

**Locked with the product owner (2026-07-16):**

1. **Payment status is an ORTHOGONAL axis, not an overload of `order_status`.** The existing
   `order_status` enum (`pending / confirmed / cancelled / fulfilled`) is the **fulfilment lifecycle** and
   keeps the meaning doc 10 gave it (the approval workflow). Money gets its **own** `payment_status`
   enum (`unpaid / awaiting_verification / paid / refunded / failed`). A COD order is legitimately
   `confirmed` **and** `unpaid` (pay on delivery); a prepaid order is `pending`/`confirmed` and `unpaid`
   until the money lands. **We never conflate the two** — the owner sees both flags and the two state
   machines never secretly drive each other (see §3.4).
2. **A charge amount is NEVER taken from the model.** `items[].price` is model-supplied and therefore
   untrusted for moving money (doc 09 §2.5). For COD/manual-transfer the stored `amount_total` is
   *advisory* (the owner verifies the physical/transfer payment anyway). For a **gateway charge**
   (Stage L) the amount MUST be **server-authoritative** — re-derived from a trusted per-tenant price map
   or **owner-approved** before a link is issued (§6.2). The model can never cause money to move at a
   number it chose.
3. **The transition to `paid` is a privileged, server-only decision** — exactly like doc 10's "approval
   is a server decision, never a model emission" (doc 10 §3.3, §7.5). `* → paid` comes **only** from (a) a
   verified gateway webhook or (b) an explicit human dashboard action. The model may at most move an order
   to `awaiting_verification` (a customer *claim* of payment + proof), which is low-trust and reversible.
4. **COD-first, gateway-last, no Stripe assumption.** `payment_methods` defaults to `{cod}`. Manual
   transfer needs only a free-text `payment_instructions` field (the tenant's account details) — no code
   integration. The gateway is one concrete implementation behind a `PaymentProvider` abstraction that
   **mirrors the `LLMProvider` abstraction** (doc 05 §3): swapping/adding a gateway is a tenant-config
   change, not an orchestrator change.
5. **No payment secret ever leaves the server.** Gateway API keys are **Vault secret references** on
   `tenants` (`payment_key_secret_id`, same shape as `openai_key_secret_id`), read server-side only via
   the existing `get_tenant_secret` helper. The only payment artefact that reaches the customer/model is a
   **hosted checkout link** (Stage L) or the tenant's own **public** account details (manual transfer).
6. **Payment proof rides on doc 10's media pipeline unchanged.** A receipt screenshot is just another
   inbound image; it is downloaded server-side, persisted to the **same private `order-media` bucket**,
   and referenced by a short-TTL signed URL. Stage K therefore **depends on doc 10 F + E4** and adds no
   new storage or RLS.

---

## 2. Interface & schema deltas (all additive)

### 2.1 Migration `0013_payments.sql`

```sql
-- Money is a SEPARATE axis from the fulfilment lifecycle (order_status). See §1.1.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type payment_status as enum ('unpaid','awaiting_verification','paid','refunded','failed');
  end if;
end $$;

alter table public.orders
  add column if not exists payment_status    payment_status not null default 'unpaid',
  add column if not exists payment_method     text,          -- 'cod' | 'manual_transfer' | 'gateway' (app-validated, §2.3)
  add column if not exists payment_provider   text,          -- gateway key (Stage L); null for cod/manual
  add column if not exists payment_reference  text,          -- gateway charge/intent id OR a manual txn reference
  add column if not exists amount_total       numeric(12,2), -- server-set (§3.3, §6.2); null until priced
  add column if not exists currency           text,          -- ISO-4217, e.g. 'PKR'; defaults from tenant
  add column if not exists paid_at            timestamptz,
  add column if not exists payment_proof      jsonb;         -- { kind:'image', storagePath, mimeType } — Stage K, reuses doc 10 media

-- Per-tenant payment configuration. Default = COD-only, no external calls ⇒ no behaviour change.
alter table public.tenants
  add column if not exists payments_enabled      boolean not null default false,
  add column if not exists payment_methods        text[]  not null default '{cod}',  -- subset of {cod, manual_transfer, gateway}
  add column if not exists payment_instructions   text,    -- free-form account details (JazzCash/Easypaisa/bank), folded into prompt (§3.2)
  add column if not exists payment_provider        text,   -- gateway key (Stage L)
  add column if not exists payment_key_secret_id   uuid,   -- Vault ref to gateway API key (Stage L), like openai_key_secret_id
  add column if not exists default_currency        text not null default 'PKR',
  add column if not exists prepaid_required         boolean not null default false; -- true ⇒ tell the customer the order is reserved until paid
```

**No new RLS and no new table.** `orders` already has `orders_select` for `user_can_access_tenant` and
service-role-only writes (migration 0009) — the new columns inherit both. The gateway webhook (Stage L)
uses the **existing `webhook_events` ledger** (a new `provider` value, e.g. `'safepay'`), and the gateway
key uses the **existing Vault helpers** — so there is **no `[OPUS]` RLS/Vault-grant gate here** (unlike
doc 10 E4). `payment_proof` reuses doc 10's `order-media` bucket, whose grants doc 10 E4 already gates.

`types/database.ts` is hand-edited to match (no CLI regen — the doc-09/10 migration workflow), and:
- `types/domain.ts` `Order` gains `paymentStatus`, `paymentMethod`, `paymentProvider`, `paymentReference`,
  `amountTotal`, `currency`, `paidAt`, `paymentProof`.
- `types/domain.ts` `Tenant` gains `paymentsEnabled`, `paymentMethods`, `paymentInstructions`,
  `paymentProvider`, `paymentKeySecretId`, `defaultCurrency`, `prepaidRequired`.
- new domain types: `export type PaymentStatus = 'unpaid'|'awaiting_verification'|'paid'|'refunded'|'failed';`
  and `export type PaymentMethod = 'cod'|'manual_transfer'|'gateway';`.

### 2.2 The `create_order` tool RESULT widens; its INPUT does not

The model still supplies only items + customer details (doc 09 §3.3) — **it never supplies payment
identity, method, status, or amount.** What changes is the **result** the executor hands back, so the model
knows what to say next about payment:

```ts
// create_order result (what the model sees), Stage J onward:
{
  orderId: string | null,
  status: OrderStatus,           // unchanged (approval axis)
  paymentStatus: PaymentStatus,  // 'unpaid' at creation
  payment?: {
    method: PaymentMethod,       // server-chosen from tenant config + customer's stated preference
    instructions?: string,       // manual-transfer: the tenant's account details (public)
    amountTotal?: number,        // advisory for cod/manual; authoritative for gateway (§6.2)
    currency?: string,
    paymentLink?: string,        // gateway only (Stage L)
  }
}
```

The `## PAYMENT` prompt block (§3.2) tells the model how to speak this. This keeps the doc-09 invariant
intact: **the model supplies content, the server supplies the money facts.**

### 2.3 App-level validation (no DB enums for the text fields)

`payment_method` and `payment_methods[]` are plain `text`/`text[]` validated in the server action with a
`const` allow-list (`PAYMENT_METHOD_VALUES = ['cod','manual_transfer','gateway'] as const`), **matching the
`media_handling` / `business_type` precedent** (doc 10 — text + app-validated, no Postgres enum, no CHECK).
Only `payment_status` gets a real enum, because it is a closed lifecycle the DB should guard (like
`order_status`).

---

## 3. Stage J — Payment foundations (COD + manual transfer, no external calls)

Ships the bulk of the real-world value with zero integration.

### 3.1 Intake wizard — a new "Payments" card

Extend the Stage-E intake wizard ([`clients/[id]/intake`](../src/app/admin/clients/[id]/intake/)):

1. **Enable payments** — `payments_enabled`.
2. **Accepted methods** — a multi-select over `{Cash on Delivery, Bank/Wallet transfer, Online gateway}`
   → `payment_methods[]`. (Gateway greyed out until Stage L config exists.)
3. **Transfer instructions** — free-text `payment_instructions` shown only when `manual_transfer` is
   picked ("JazzCash 0300-xxxxxxx (Title: …); or Meezan Bank acct …"). This is the tenant's **own public
   details**, folded verbatim into the prompt (§3.2).
4. **Currency** — `default_currency` (default `PKR`).
5. **Prepaid?** — `prepaid_required`: "Tell customers the order is reserved until payment is received."
   (Purely a wording toggle in Phase 2; it does **not** auto-gate fulfilment — see §3.4.)

Same server-action pattern as the rest of the wizard; all reachable by the agency now and by the client
after the Phase-2 login unlock (doc 10 §9 — this card carries over with no rewrite).

### 3.2 `## PAYMENT` prompt block (deterministic, cache-safe)

A new static per-tenant block after `## ORDER FLOW` / `## SERVICE FLOW`, gated on `payments_enabled`,
composed from stable ordered parts so the cache prefix stays byte-identical per tenant config (doc 05 §2,
doc 10 §3.2). It is **operational text only — mechanical for Sonnet**, exactly like `ORDER_FLOW_BLOCK`:

```
## PAYMENT
This business accepts: <human list derived from payment_methods>.
- If the customer chooses Cash on Delivery, no prepayment is needed; confirm COD on the order.
- If the customer chooses bank/wallet transfer, share these exact details and ask them to send a
  screenshot of the receipt once paid:
  <payment_instructions verbatim>            ← only present when manual_transfer is enabled
- <gateway line — Stage L: "share the secure payment link from the tool result">
Read the payment total back from the tool result; NEVER invent or change an amount.
After create_order returns, tell the customer the payment method and the exact next step from the
tool result. Do not tell a customer their payment is confirmed — only the business confirms that.
```

`promptBuilder.buildPaymentBlock(tenant)` follows the exact shape of `buildServiceFlowBlock` /
`buildCustomOrdersBlock` already in the repo. The "never invent an amount / never self-confirm payment"
lines are load-bearing guardrail-adjacent text; they are simple enough to ship in Stage J, but the
**gateway-specific anti-fraud wording** (what the model may and may not say about a payment link) is
finalised under Opus with **L** — leave a `TODO(opus:L)` placeholder for that one line, mirroring doc 10's
`TODO(opus:F1)` pattern.

### 3.3 What the executor does with money (Stage J)

In `create_order`'s executor, after the order row is created (identity server-bound, doc 09 §2.5):

1. Choose `payment_method` **server-side** from `tenant.payment_methods` and the customer's stated
   preference (the model may pass a *hint* like `notes: "wants COD"`, but the executor validates it
   against the tenant's enabled methods and picks the final value — the model does not set the column).
2. Compute an **advisory** `amount_total = Σ items[].qty × items[].price` **only if every item carries a
   price**; otherwise leave it null (owner prices it). Set `currency = tenant.default_currency`.
3. Set `payment_status = 'unpaid'`. **Do not** touch `order_status` for payment reasons (§3.4).
4. Return the `payment` object (§2.2) so the model can speak the next step.

For **manual transfer**, `instructions = tenant.payment_instructions`. For **COD**, no instructions. The
owner WhatsApp push (doc 09 §4) gains the method + amount in its body params (an ops template change, not
code — noted in §11).

### 3.3.1 J1 decision — FROZEN (Opus, 2026-07-16)

The two coupled money-safety rules the rest of J / K / L build on. Both are **server decisions**; the model
supplies content only. This is the `[OPUS]` gate J1 (§11) — no code, a frozen contract.

**A — Payment method + amount + status authority (the executor rule).**

*Inputs the executor trusts (server-side):* `tenant.paymentsEnabled`, `tenant.paymentMethods`,
`tenant.paymentInstructions`, `tenant.defaultCurrency`, `tenant.prepaidRequired`, and the order's own
`items[]`. *Untrusted input the model MAY pass:* one **new, optional** `create_order` arg
`payment_preference?: string` — a HINT capturing the customer's stated choice ("cod" / "bank transfer" /
free text). It is normalised + validated, never used as-is; the model still cannot set any payment column.
(Additive optional arg ⇒ no change to existing behaviour.)

1. **Method.** `enabled = tenant.paymentMethods ∩ {cod, manual_transfer, gateway}` (allow-list validated,
   §2.3).
   - `!paymentsEnabled` **or** `enabled = ∅` → **no payment object**; `payment_method = null`; behaves
     exactly as the doc-09/10 order-taker (acceptance #1).
   - Else `method =` the normalised `payment_preference` **iff** it ∈ `enabled`; else the single enabled
     method when `|enabled| = 1`; else the **priority default** `cod > manual_transfer > gateway`
     (`PAYMENT_METHOD_PRIORITY`). COD-as-last-resort is safe — it needs no prepayment and shares no account
     details. The `## PAYMENT` block (§3.2) instructs the model to *offer the enabled methods and capture
     the choice into `payment_preference` before calling `create_order`*, so the fallback is rarely hit.
   - Normalisation maps common synonyms (jazzcash/easypaisa/bank/transfer → `manual_transfer`; cash/COD →
     `cod`; card/online/link → `gateway`) → a `PaymentMethod`, defaulting to `null` (unresolved ⇒ fallback).
   - `gateway` is **not reachable in Stage J** (the wizard greys it until Stage L config exists); the branch
     exists only for forward-compat.
2. **Amount — ADVISORY in Stage J.** `amount_total = Σ(qty × price)` **iff every** `items[]` entry has a
   numeric `price > 0`; else `null` (owner prices it). `currency = tenant.defaultCurrency`. This total is
   derived from **model-supplied, untrusted** prices, so it is **advisory only** — acceptable for COD /
   manual transfer because the owner verifies the real money regardless (locked decision #2). **It MUST NOT
   be used to issue a gateway charge**: Stage L re-derives an authoritative amount from a trusted price map
   or owner approval (§6.2). A future reader wiring Stage L must **not** pass this advisory number into
   `createCheckout`.
3. **Status.** `payment_status = 'unpaid'` at creation, always. Payment logic **never** touches
   `order_status` (§3.4). The model can move `payment_status` by **no** argument. The only later transitions
   are server-side: `→ awaiting_verification` via Stage-K proof routing (B below), and the **privileged**
   `→ paid / refunded / failed` via a human dashboard action (§3.5) or a signature-verified gateway webhook
   (§6.3) — never the model (§1.3).
4. **Result.** The executor returns the §2.2 `payment` object (method; `instructions` for manual transfer;
   advisory `amountTotal`/`currency`) so the model can speak the next step — it never echoes a column the
   model could have influenced.

*Invariant (acceptance #6):* across the entire tool surface the model can set **none** of `payment_status,
payment_method, amount_total, currency, paid_at, payment_reference, payment_provider, payment_proof`. It
supplies only `items[]`, customer fields, and the untrusted `payment_preference` hint.

**B — Proof-vs-example image routing (server-decided, used by Stage K §5).**

When an image arrives (after doc-10 download+persist to `order-media` **and** the doc-10 §2.3
`chat_messages.attachments` write — both happen regardless of route), the orchestrator decides the
**order-level** route from **session context only** — never from the model's say-so or the untrusted image
caption:

```
proofTarget = most-recent order in THIS session where
    payment_method = 'manual_transfer'
    and payment_status = 'unpaid'                       # not already awaiting/paid
    and order_status not in ('cancelled','fulfilled')
    and payment_proof is null                           # no proof attached yet
    and created_at >= now() - PROOF_MATCH_WINDOW_HOURS  # default 72h, tunable

if proofTarget:   → route as PAYMENT PROOF
    orders.attachProof(proofTarget.id, {kind:'image', storagePath, mimeType})   # service-role
    orders.setPaymentStatus(proofTarget.id, 'awaiting_verification')            # reversible, low-trust
    tell the customer the receipt was received & the business will verify; the model MUST NOT say 'paid'
    (do NOT also run the doc-10 example/vision order flow on this image)
else:             → route as CUSTOM-ORDER EXAMPLE (doc-10 F path) iff customOrdersEnabled
                    and media_handling != 'reject'; otherwise persist + ask for a text description
                    (or [HUMAN_HANDOFF] when media_handling = 'reject').
```

*Precedence & why it is safe.* **Proof beats example** — an open unpaid manual-transfer order is the
strong, specific signal, and misreading a receipt as a "new order example" (starting an order off a
bank-app screenshot) is the worse failure. Routing to proof only ever reaches **`awaiting_verification`**,
a reversible, human-verified state; the owner **Verify → paid** / **Reject → unpaid** in the dashboard
(§3.5). So a wrong route **moves no money** and is fully recoverable — the "attach it and let the owner
judge" safety net (§5). The caption is handed to the model as the text turn *after* routing and is **not**
a routing input (untrusted injection surface, doc 10 §7.3). Known, accepted misroute: a customer sending a
genuinely new example image while an old manual-transfer order is still unpaid gets it attached as
"proof"; the owner Rejects it — safe and rare. Using an explicit model intent-signal as a *tiebreaker* is
deliberately **out of J1 scope** (it would re-introduce trusting model output for a money-adjacent route).

*Service surface this implies (built in J2/J5/K1, not J1):* `orders.attachProof(id, ref)`,
`orders.setPaymentStatus(id, status)`, plus the human `orders.markPaid(id, ref?)` / `orders.markRefunded(id)`
— all service-role writes behind an RLS access-check in the dashboard actions (the doc-10 Approve/Reject
pattern). New constants: `PAYMENT_METHOD_PRIORITY = ['cod','manual_transfer','gateway']` and
`PROOF_MATCH_WINDOW_HOURS` (default 72).

### 3.4 The two axes stay decoupled (the honest, non-magical rule)

**Payment never mutates `order_status`, and approval never mutates `payment_status`.** A prepaid order that
also needs approval (doc 10) still waits for the owner's Approve even after it is `paid`; a `paid` COD-less
order that is `pending` for approval is shown as *both* in the dashboard. `prepaid_required` changes only
what the **customer is told** ("reserved until payment received"), not the stored lifecycle. This avoids a
hidden coupling that would make the state impossible to reason about. If a tenant later wants "auto-confirm
on paid," that is a deliberate, separately-designed rule — **not** a silent side effect here.

### 3.5 Dashboard — payment column + owner actions

Extend `/admin/orders` (built in doc 09 B3 / doc 10 E3):

- A **payment_status** badge column next to `status`, plus `payment_method`, `amount_total`, `currency`.
- On any `unpaid`/`awaiting_verification` order, an owner action **"Mark paid"** (and **"Mark refunded"**)
  — the **human** transition of §1.3, run under the **RLS server client as an access-check** then the
  service-role write (the `manualSendAction` / doc-10 Approve-Reject pattern). Sets `payment_status='paid'`,
  `paid_at=now()`, optional `payment_reference` (a note field for the txn id).
- Realtime already streams `orders` updates, so a payment marked anywhere updates every open dashboard.

---

## 4. Stage I — Order edit & cancel  (independent; can ship first)

Right now a customer can *create* an order but can never *change* or *cancel* it through the AI — every
such ask becomes a `[HUMAN_HANDOFF]`. Stage I closes that. It is **independent of payment** and mostly
mechanical; it reuses the exact session-scoped, server-bound-identity pattern of the `check_order_status`
tool already shipped.

### 4.1 Two new tools (session-scoped, server-bound identity)

`edit_order` and `cancel_order` in `services/tools/`. Both take an optional `order_id` and are scoped
entirely by `ctx.session.id` (a customer can only touch **their own** conversation's orders — the model
cannot pass another session/tenant id, doc 09 §2.5). Registered behind `tenant.ordersEnabled`.

```ts
// edit_order args (the model supplies the NEW desired items/details; identity is server-bound):
{ order_id?: string, items?: [...], customer_name?, customer_phone?, customer_address?, notes? }
// cancel_order args:
{ order_id?: string, reason?: string }
```

If `order_id` is omitted, the tool targets the session's **most recent editable order** (via
`orders.listForSession`, already built). If none is editable, it returns a structured
`{ error, reason }` the model turns into a polite explanation or a handoff.

### 4.2 The state-transition guard (the one part that needs care — fully specified here, so `[SONNET]`)

The executor consults this table **before** writing. It reads the order's **both** axes:

| `order_status` | `payment_status` | edit? | cancel? |
|---|---|---|---|
| `pending` | `unpaid` / `awaiting_verification` | ✅ | ✅ |
| `confirmed` | `unpaid` / `awaiting_verification` | ✅ (re-approve, §4.3) | ✅ |
| any | `paid` | ❌ → refund is a human/Stage-L action → `[HUMAN_HANDOFF]` | ❌ → refund is human → `[HUMAN_HANDOFF]` |
| `fulfilled` / `cancelled` | any | ❌ (terminal) | ❌ (terminal) |

- **Cancel** allowed cells → `orders.cancel(orderId, reason)` sets `order_status='cancelled'` (reuses the
  `reject` write already in `services/orders.ts`; add a thin `cancel` alias or reuse `reject`), merges the
  reason into `notes`, and the model confirms the cancellation.
- **Edit** allowed cells → `orders.edit(orderId, patch)` updates items/customer fields via service role,
  re-computes the dedupe fingerprint, and (see §4.3) may re-open approval.
- Any ❌ cell → the tool returns `{ error, needsHuman: true }`; the model emits `[HUMAN_HANDOFF]`. A paid
  order's change/refund is deliberately **out of the AI's authority** — money already moved.

### 4.3 Edit re-opens approval for custom orders

If the tenant is `customOrdersRequireApproval` **and** the order is a custom one, an `edit_order` flips
`order_status` back to `pending` (server-decided, §1.3 / doc 10 §3.3) so the owner re-approves the changed
order. A bypass-mode tenant's edit stays `confirmed`. The owner push / dashboard surfaces the re-opened
order exactly as a new pending one (doc 10 §3.4) — **no new surface**.

### 4.4 Prompt lines (appended to the order/service flow blocks)

Two mechanical lines, same style as the `check_order_status` line already added:
> *"If a customer wants to change an order they placed, call edit_order with the new details. If they want
> to cancel, call cancel_order. If the order is already paid or fulfilled, do not edit/cancel it — use
> [HUMAN_HANDOFF] so a person can help with a refund."*

---

## 5. Stage K — Payment proof (receipt screenshot → verification)

The manual-transfer loop's second half: the customer pays into the tenant's account and **sends a
screenshot**. This is **doc 10's image pipeline with a different destination field** — nothing new in the
media layer.

- **Depends on doc 10 F (media download + `order-media` bucket + signed URLs) and E4 (bucket RLS).**
- When an inbound image arrives on a session that has a recent `manual_transfer` order in
  `payment_status='unpaid'`, the orchestrator (after doc 10's download+persist) treats it as **payment
  proof**: it writes `orders.payment_proof = { kind, storagePath, mimeType }` and moves
  `payment_status → awaiting_verification` via the orders service (service-role). The model tells the
  customer the receipt was received and the business will confirm shortly. **The model does not mark it
  paid** (§1.3).
- Disambiguation (proof vs a new custom-order example image) is decided **server-side** from context (is
  there an open unpaid manual-transfer order for this session?), not by trusting the model — with a safe
  fallback of attaching it to the order and letting the owner judge. **This routing rule is now FROZEN in
  §3.3.1 (B)** — implement K1 to that decision tree exactly (proof-precedence, `PROOF_MATCH_WINDOW_HOURS`,
  caption not a routing input, `→ awaiting_verification` only).
- Dashboard: the pending-order / order detail view (doc 10 §3.4) shows the **proof thumbnail** (signed
  URL) with **Verify → paid** / **Reject** owner actions (the §3.5 human transition).

No new schema (the `payment_proof` column ships in 0013). No `[OPUS]` gate of its own beyond the J1
routing note.

---

## 6. Stage L — Hosted gateway (`PaymentProvider` abstraction)  `[OPUS]` design first

The only stage with real external integration, and the one carrying the sharpest money-safety decisions.
Designed in its own Opus pass; the sketch:

### 6.1 The abstraction (mirrors `LLMProvider`)

```ts
export interface PaymentProvider {
  readonly id: string;                          // 'safepay' | 'payfast' | ...
  /** Create a hosted checkout for an order; returns a link to share + the provider's charge/intent id. */
  createCheckout(args: {
    tenant: Tenant; orderId: string;
    amountMinor: number; currency: string;      // server-authoritative (§6.2)
    apiKey: string;                             // from Vault, in memory only
  }): Promise<{ paymentLink: string; providerRef: string }>;
  /** Verify + parse an inbound webhook (raw body + headers) into a normalised event. */
  verifyWebhook(rawBody: string, headers: Headers, secret: string):
    Promise<{ ok: boolean; providerRef?: string; status?: 'paid'|'failed'|'refunded' }>;
}
export function getPaymentProvider(id: string): PaymentProvider;   // factory; throws on unknown
```

The orchestrator/executor only ever import `getPaymentProvider` + the interface — adding a gateway is a
tenant-config change, not an orchestrator change (the doc 05 §3 pattern).

### 6.2 The trusted-amount rule (the crux `[OPUS]` decision)

A gateway **charge amount must be server-authoritative** (§1.2). Two admissible sources, in order:
- **(a) Trusted price map** — when `tenant.catalog_data` carries canonical prices keyed by `sku`/`name`,
  the executor **re-derives** the total from the catalogue (not from the model's `items[].price`) and
  issues the link for that amount.
- **(b) Owner-approved amount** — otherwise the order is created `pending` with **no** link; it lands in the
  approval queue (doc 10 §3.4) where the owner **sets/confirms the amount**, and *only then* is the payment
  link created and sent (via the existing manual-send / take-over path, or an automated follow-up). The
  model never issues a link for a price it chose.

The Opus pass picks the exact rule (likely: (a) when a price map exists and matches every line, else fall
back to (b)); this is money-correctness, not mechanics.

### 6.3 The payment webhook (`app/api/webhooks/payments/[provider]/route.ts`)

A new route following the **identical discipline as the Meta webhook** (doc 02 §5, doc 06 §1.2):
1. Read the **raw body** (signatures are over exact bytes).
2. `provider.verifyWebhook(rawBody, headers, secret)` — constant-time signature check; mismatch → `401`.
3. **Idempotency via the existing `webhook_events` ledger** (`provider = '<gateway>'`, `provider_msg_id =`
   the event id) — duplicate → ACK `200` and stop.
4. Resolve the order by `payment_reference = providerRef`; apply the **privileged** transition
   (`paid` / `failed` / `refunded`) via the orders service (service-role). Set `paid_at`.
5. Return `200`; realtime updates the dashboard. **This is the only path (besides a human) that may set
   `paid` (§1.3).**

`[OPUS]` reviews: the provider interface, the webhook signature/idempotency, and the §6.2 trusted-amount
rule. The gateway API key is a Vault reference (`payment_key_secret_id`) read via the existing
`get_tenant_secret` helper — **no new Vault grant**, so that part is *not* a separate gate.

### 6.4 L1 decision — FROZEN (Opus, 2026-07-16)

Locks the three open Stage-L decisions. Still a design (no code); the Stage-L **build** stays Sonnet, after
Stage J exists.

**1. `PaymentProvider` interface — locked as §6.1, with three tightenings:**
- `createCheckout` takes `amountMinor` (integer, the currency's ISO-4217 minor unit) + `currency`, **both
  server-authoritative** (rule 2), plus an **idempotency key = `orderId`** so re-issuing a link for the
  same order never mints a second charge (the adapter forwards it to the gateway's idempotency mechanism;
  the route also reuses an existing unpaid `payment_reference` — rule 3).
- Minor-unit conversion uses a per-currency ISO-4217 exponent (PKR = 2). If a concrete gateway wants whole
  rupees, that coercion is a **provider-adapter** detail, never the abstraction's.
- `verifyWebhook` additionally returns the observed **paid `amountMinor` + `currency`**, so the route can
  cross-check the charged amount (rule 3). The signature check is constant-time and lives inside the adapter.

**2. Trusted-amount rule (the money crux) — locked:**
- **Re-derive from the catalogue, never the model.** For each `items[]` line, resolve a canonical price from
  `tenant.catalog_data` by `sku` (preferred) else exact normalised `name`. A line **matches** iff it
  resolves to exactly **one** catalogue price.
- **All lines match →** authoritative `amountMinor = Σ(qty × catalogue_price)` (NOT `items[].price`); the
  AI-facing flow may auto-issue the link for **that** amount. This is the *only* auto-issue path.
- **Any line unmatched** (unknown/ambiguous item, or a custom order with no catalogue price) → **no link**;
  the order is created `pending` + `unpaid`, lands in the approval queue (doc 10 §3.4), the **owner sets/
  confirms the amount**, and only then is a link created (an explicit owner "Create payment link" dashboard
  action, or the manual-send / take-over path) and sent. The model never issues a link for a price it chose
  (§1.2). The Stage-J **advisory** `amount_total` is display-only and is **never** promoted to a charge.

**3. Signed webhook (`app/api/webhooks/payments/[provider]/route.ts`) — locked to the Meta-webhook
discipline (doc 02 §5) plus an amount cross-check:**
1. Read the **raw body**; `getPaymentProvider(provider).verifyWebhook(raw, headers, secret)` — bad
   signature → **401**. `secret` is a **Vault ref** on `tenants`: add **`payment_webhook_secret_id uuid`**
   (distinct from `payment_key_secret_id`, because gateways sign webhooks with a *separate* secret), read
   via the existing `get_tenant_secret` helper — **no new Vault grant**.
2. **Idempotency** via the existing `webhook_events` ledger (`provider='<gateway>'`, `provider_msg_id =` the
   event id); duplicate → ACK **200**, stop.
3. Resolve the order by `payment_reference = providerRef`. **Not found →** log + ACK **200** (never 5xx —
   avoid provider retry storms); no transition.
4. **Amount cross-check (money-safety, beyond the §6 sketch):** compare the webhook's paid
   `amountMinor`+`currency` to the order's **authoritative** amount (the one the link was issued for).
   **Mismatch →** do **not** mark `paid`; hold for human review (status unchanged, owner notified) — a
   "paid the wrong amount" event is never silently accepted.
5. **Match →** apply the **privileged** transition `paid` (or `failed` / `refunded`) via the orders service
   (service-role); set `paid_at`, `payment_reference`. Return **200**; realtime updates the dashboard. This
   webhook and the human "Mark paid" action are the **only** paths that may set `paid` (§1.3).

**Schema for Stage L** (migration, e.g. `0017_payment_gateway.sql`): add `tenants.payment_webhook_secret_id
uuid` (Vault ref). `payment_provider` + `payment_key_secret_id` already ship in `0013`. No new table/RLS
(reuses `webhook_events`, `orders`, Vault) — so, like Stage J, **Stage L has no RLS/Vault-grant `[OPUS]`
gate**; L1's gate is exactly the interface + trusted-amount + webhook signature/amount decisions above, now
frozen. **Sonnet may build Stage L against §6.1–§6.4 once Stage J exists — no further Opus pass.**

---

## 7. Security model

Enforced server-side; extends doc 02, doc 09 §2.5, doc 10 §7.

1. **The transition to `paid` is privileged and server-only** — only a signature-verified gateway webhook
   or an explicit human dashboard action. The model can reach at most `awaiting_verification` (a reversible
   customer *claim*). (§1.3)
2. **No charge amount from the model.** Gateway amounts are server-authoritative (§6.2). COD/manual amounts
   are advisory and owner-verified.
3. **No payment secret leaves the server.** Gateway keys are Vault references read in memory only; the
   customer/model see only a hosted link or the tenant's own public account details. No key/secret in any
   tool result, order row, log, prompt, or client bundle (doc 02 non-negotiable).
4. **Payment webhook = raw-body + constant-time signature + `webhook_events` idempotency** (doc 02 §5).
5. **Payment proof is untrusted media** — downloaded server-side with the tenant token, stored in the
   private `order-media` bucket, referenced by short-TTL signed URL; its *contents are the customer's
   claim, never instructions* (the doc 10 §7.3 image-injection rule applies unchanged). Routing an image
   to "proof vs example" is a **server** decision (§5).
6. **Identity stays server-bound** for `edit_order` / `cancel_order` (session-scoped; a customer cannot
   touch another session/tenant's order), and a `paid`/`fulfilled` order is beyond the AI's authority (§4.2).

---

## 8. Cost, idempotency & abuse

- **Idempotency:** `edit_order`/`cancel_order` are naturally idempotent-ish (setting the same state twice
  is harmless); the gateway webhook dedupes on `webhook_events` (§6.3). A retried proof image doesn't
  double-transition because `awaiting_verification → awaiting_verification` is a no-op.
- **Abuse:** the existing per-session order cap (doc 09 §6) already bounds order churn; add nothing new for
  edit/cancel beyond bounding edits per order per window if churn is observed (a constant, deferred until
  seen). Payment-link creation is gated by order creation, which is already capped.
- **Metering:** no new LLM cost from payments themselves; a gateway call is a normal HTTP call (not
  metered as LLM usage). Proof images meter as doc-10 vision rounds if the model is asked to read them.

---

## 9. How this feeds the Phase-2 client dashboard

Everything here is **built agency-side now but is the client-dashboard surface** for Phase-2 logins (doc 10
§9). No throwaway:
- The **Payments intake card** → the client's own "Payment settings."
- The **payment column + Mark-paid / Verify-proof actions** on `/admin/orders` → the client manages **their
  own** orders' payments; the actions already run under the RLS server client, so they are tenant-safe
  as-is (the doc 09 §3.5 pattern).
- The **gateway key** rides the same Vault-reference model as the LLM/Meta keys the client already owns.

The only new work to make it client-facing remains the single doc-10 §9 routing change (admit
`tenant_admin` past the `is_platform_admin` gate) — the data layer already enforces isolation.

---

## 10. Acceptance criteria

- [ ] A tenant with `payments_enabled=false` behaves exactly as the doc-09/doc-10 order-taker.
- [ ] **COD:** a customer picks COD; the order lands `unpaid`, the model states COD, the owner sees
      `payment_status=unpaid, method=cod` and can later **Mark paid**.
- [ ] **Manual transfer:** the model shares the tenant's exact `payment_instructions`, asks for a receipt,
      and never invents an amount; the order is `unpaid` until proof/verification.
- [ ] **Proof (Stage K):** a receipt screenshot moves the order to `awaiting_verification` with the image
      in the private bucket (signed-URL only); **Verify** flips it to `paid` + `paid_at`; **Reject** leaves
      it `unpaid`. No token/url leaks to the model or browser.
- [ ] **Gateway (Stage L):** a link is issued **only** for a server-authoritative amount (§6.2); a
      signature-verified webhook is the only automated path to `paid`; a bad signature is rejected; a
      duplicate webhook does not double-transition.
- [ ] **The model can never set `paid`, never invent/alter a charge amount, and never leak a payment key** —
      verified by test.
- [ ] **Edit:** an editable order is changed via `edit_order`; a custom order under approval re-opens to
      `pending`; the dashboard shows the change.
- [ ] **Cancel:** an editable order is cancelled via `cancel_order`; a **paid/fulfilled** order is NOT
      edited/cancelled by the AI — it hands off — verified by the §4.2 guard table.
- [ ] The two axes stay decoupled: a `paid` order still awaits approval if approval is required, and vice
      versa (§3.4) — verified by test.
- [ ] A Phase-2 `tenant_admin` sees/acts on only their own tenant's payments — the two-tenant RLS test,
      with no policy change.

---

## 11. Build order for Sonnet

**Stage I (order edit/cancel — independent, ship first):**
1. **I1** — `edit_order` + `cancel_order` tools (§4.1) with the §4.2 guard table; `orders.edit()` +
   reuse/alias `orders.cancel()`; register behind `ordersEnabled`; the re-approve rule (§4.3); the two
   prompt lines (§4.4). No schema change. Typecheck + build green.

**Stage J (payment foundations — no external calls):**
2. **J1** `[OPUS]` — ✅ **DECIDED & FROZEN in §3.3.1 (Opus, 2026-07-16).** **Two coupled money-safety
   decisions**: (a) the executor's **server-side method/amount rule** (never model-set status/amount;
   advisory vs authoritative; §3.3.1 A, §1.2) as it will also anchor Stage L, and (b) the
   **proof-vs-example image routing rule** (§3.3.1 B, §5) that decides how an untrusted image is dispatched.
   These set the security contract the rest of J/K/L fill in. Sonnet may now build J2–J5 (and K1) directly
   against §3.3.1 — no further Opus pass needed for J.
3. **J2** — migration `0013` (payment cols + tenant payment config); hand-edit `database.ts`; extend
   `Order`/`Tenant` domain types + `mapOrder`/`mapTenant`; add `PaymentStatus`/`PaymentMethod` types.
4. **J3** — the Payments intake card (§3.1) + server action (app-validated method allow-list, §2.3).
5. **J4** — `buildPaymentBlock` in `promptBuilder` gated on `paymentsEnabled` (§3.2), operational lines
   only; leave `TODO(opus:L)` for the gateway anti-fraud line. Wire the widened `create_order` result
   (§2.2) + executor money logic (§3.3, per the J1 contract).
6. **J5** — `/admin/orders` payment column + **Mark paid / Mark refunded** owner actions (§3.5), RLS
   access-check → service-role write (the doc-10 Approve/Reject pattern).

**Stage K (payment proof — needs doc 10 F + E4):**
7. **K1** — orchestrator routes a proof image (per the J1 rule) → `payment_proof` + `awaiting_verification`;
   dashboard proof thumbnail + **Verify / Reject** actions (§5).

**Stage L (hosted gateway):**
8. **L1** `[OPUS]` — ✅ **DECIDED & FROZEN in §6.4 (Opus, 2026-07-16):** the `PaymentProvider` interface
   (§6.1), the **trusted-amount rule** (§6.2), and the **signed payment webhook** + `webhook_events`
   idempotency + amount cross-check (§6.3–§6.4), plus the `payment_webhook_secret_id` Vault ref. Then
   implement the chosen concrete provider mechanically — no further Opus pass needed for Stage L.

**Ops (parallel, not code):** the owner-notify WhatsApp template gains payment method/amount body params
(a template change → Meta approval, like doc 09's `new_order_alert`).

---

`[OPUS]` gates recap — two, each a money-safety/architecture decision, never a mechanical one:
- **J1** — ✅ **DECIDED (§3.3.1, 2026-07-16):** the server-side method/amount authority rule (model never
  sets status/amount) **and** the untrusted-image proof-vs-example routing rule (§3.3.1, §5, §1.2).
- **L1** — ✅ **DECIDED (§6.4, 2026-07-16):** the `PaymentProvider` interface, the trusted-amount rule for
  gateway charges, and the signed payment webhook + idempotency + amount cross-check (§6).

**Both `[OPUS]` gates in this doc are now cleared — Stages I–L are all Sonnet-buildable.**

Everything else is mechanical for Sonnet given this document. A Sonnet builder reaching an `[OPUS]` step
**pauses and asks the user to switch to Opus** (per `CLAUDE.md`), rather than improvising the decision.
