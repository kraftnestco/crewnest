# 09 — Orders & Tool-Calling (Phase 2)

This is the design for turning the assistant from *answering* into *doing*: walking a customer through
the catalogue, collecting their details, confirming an order, persisting it, and notifying the business
owner. It is the concrete build-out of the Phase-2 line in
[`07-PHASES.md`](./07-PHASES.md) — *"Tool-calling / workflows: the `tool` message role goes live;
tenant-scoped tools (…create lead…)"* — and its `[OPUS]` checkpoint *"Tool-calling security model."*

**Designed in an Opus session (2026-07-10).** Implementation is mechanical for Sonnet, stage by stage.
Nothing here redesigns a locked interface; the interface deltas in §2.1 are **additive and
backward-compatible** (the existing text-only path behaves identically when a tenant has no tools).

---

## 1. Scope, staging & decisions

Four independently shippable stages. **A + B alone give a working text order-taker** with orders
visible in the dashboard and zero new external services.

| Stage | What | Depends on | Model |
|-------|------|-----------|-------|
| **A** | Tool-calling foundation (provider interface, orchestrator loop, registry, security) | — | `[OPUS]` design (this doc) → `[SONNET]` build |
| **B** | Orders domain (table, `create_order` tool, dashboard Orders tab) | A | `[SONNET]` |
| **C** | Notifications (owner via WhatsApp template, customer confirmation via existing send) | B | `[SONNET]`; template approval is ops, not code |
| **D** | Image / vision (phone-case screenshot → catalogue match) — **deferred follow-up** | A–C | `[OPUS]` design pass first (§7 is a sketch only) |

**Decisions locked with the product owner (2026-07-10):**
- Owner notification = **dashboard AND WhatsApp, together** (not either/or). Orders always persist and
  stream live into the dashboard Orders tab, *and* the owner gets a WhatsApp push to their own number.
  The dashboard lets the agency (and, in Phase 2, the client) watch **live orders and the live chat
  inbox side by side**, plus browse full **order history**. SMS (Twilio) is the documented WhatsApp
  fallback. See §3.4 (dashboard) and §4 (WhatsApp).
- **Text order-taking ships first**; the image/screenshot pipeline (§7) is a separate later pass.

---

## 2. Stage A — Tool-calling foundation

### 2.1 Interface deltas (`services/ai/provider.ts`)

All additive. A request with no `tools` produces exactly today's behaviour.

```ts
export interface LlmToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;   // JSON Schema for the args object
}

export interface LlmToolCall {
  id: string;             // provider-assigned id; echoed back on the tool-result message
  name: string;
  arguments: string;      // RAW JSON string exactly as the model emitted it (parse + validate later)
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: LlmToolCall[];   // set on an ASSISTANT turn that requests tools
  toolCallId?: string;         // set on a TOOL-result turn: which call it answers
}

export interface LlmRequest {
  model: string;
  messages: LlmMessage[];
  cachePrefixLength?: number;
  temperature?: number;
  maxTokens?: number;
  tools?: LlmToolDef[];        // NEW — omit ⇒ no tool-calling (today's path)
}

export interface LlmResult {
  text: string;
  toolCalls?: LlmToolCall[];   // NEW — present when the model wants to call tools (text may be empty)
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  raw?: unknown;
}
```

### 2.2 Provider implementations

**`openai.ts`** — this also removes the existing `as unknown as` cast hack ([openai.ts:22-25](../src/services/ai/openai.ts)) by mapping messages properly:
- Map `req.tools` → `tools: [{ type:'function', function:{ name, description, parameters } }]`.
- When serialising history: an assistant message with `toolCalls` → `tool_calls:[{id,type:'function',function:{name,arguments}}]`; a `role:'tool'` message → `{ role:'tool', tool_call_id, content }`.
- Read the response: `choices[0].message.tool_calls` → `LlmToolCall[]`; `content` → `text`.

**`openrouter.ts`** — OpenRouter is OpenAI-wire-compatible, so this is the same mapping. **Caveat:** not all OpenRouter models (especially `:free` ones) support function-calling reliably; a tenant using tools should run on a tool-capable model (`gpt-4o-mini` on OpenAI, or a paid tool-capable OpenRouter model). Document per-tenant.

### 2.3 Orchestrator loop (`services/aiOrchestrator.ts`)

Replace the single `provider.chat` call ([aiOrchestrator.ts:90-98](../src/services/aiOrchestrator.ts)) with a
**bounded loop**. Everything before (steps 1–8) and after (handoff detection, persist, dispatch) is
unchanged.

```ts
const tools = getEnabledTools(tenant);          // [] when the tenant has no tools ⇒ identical to today
const conversation: LlmMessage[] = [...built.messages];
let finalText = '';

for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
  const result = await provider.chat(
    { model: tenant.llmModel, messages: conversation, cachePrefixLength: built.cachePrefixLength,
      tools: tools.length ? tools.map((t) => t.def) : undefined },
    key,
  );
  await messages.logUsage({ /* … */ usage: result.usage /* every round is metered */ });

  if (result.toolCalls?.length) {
    conversation.push({ role: 'assistant', content: result.text ?? '', toolCalls: result.toolCalls });
    for (const call of result.toolCalls) {
      const toolResult = await executeTool(call, { tenant, session });   // tenant BOUND here (§2.5)
      conversation.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(toolResult) });
    }
    continue;                       // let the model see the results and produce the next turn
  }

  finalText = result.text;
  break;                            // plain-text turn ⇒ done
}
// If the loop exhausts MAX_TOOL_ROUNDS with no text turn, fall back to a safe canned line or handoff.
```

- `MAX_TOOL_ROUNDS` (new constant, e.g. `3`) caps cost and prevents infinite loops.
- Handoff detection (`assistantRequestedHandoff` / `stripHandoffToken`) runs on `finalText`, unchanged.
- **Trigger-agnostic property preserved:** the orchestrator imports the tool registry as an interface
  (like it already imports `getProvider`, `sendText`, `messages.persist`). The registry's executors are
  the leaf services that touch the service-role client / Vault — the orchestrator never imports
  `server-only` itself.

### 2.4 Tool registry (`services/tools/`)

```ts
export interface ToolContext { tenant: Tenant; session: ChatSession; }

export interface ToolExecutor {
  def: LlmToolDef;                       // name/description/JSON-schema shown to the model
  argsSchema: z.ZodTypeAny;              // server-side validation of the model's args
  execute(args: unknown, ctx: ToolContext): Promise<unknown>;   // returns a value fed back to the model
}

/** Tenant-scoped: which tools this tenant may use. Gated by tenant flags (§3.1). */
export function getEnabledTools(tenant: Tenant): ToolExecutor[];

/** Parse+validate model args, run the executor, return a result (or a structured error) to the model. */
export function executeTool(call: LlmToolCall, ctx: ToolContext): Promise<unknown>;
```

- Tools are defined **only in server code**. The customer's message can never introduce a tool; the
  model can only call tools we advertised in `req.tools`.
- `getEnabledTools` reads per-tenant flags (`tenants.orders_enabled`), so a tenant with orders off runs
  the plain answering path.

### 2.5 Security model (the `[OPUS]` checkpoint)

Non-negotiables — enforce all of these in `executeTool` / each executor:

1. **The model supplies contents; the server supplies identity.** `tenant_id` (and `session_id`,
   `platform`, `external_user_id`) come from `ToolContext`, **never** from the model's arguments. The
   model cannot target another tenant even if it emits one.
2. **Validate every arg** against `argsSchema` (zod) before executing. On invalid args, return a
   structured `{ error }` to the model (which lets it ask the customer again) — never throw into the
   loop.
3. **Executors run with least privilege.** DB writes go through the `orders` service (service-role,
   RLS-bypassing, server-only) — the same trust boundary as `messages.persist`.
4. **Idempotency + abuse caps** (§6): a `create_order` must not double-insert on a retried turn, and a
   session has a per-window order cap.
5. **No secrets to the model.** Tool *results* returned to the model contain only non-sensitive data
   (e.g. an order id + status), never tokens/keys/internal ids beyond what's needed to converse.

---

## 3. Stage B — Orders domain

### 3.1 Schema — migration `0009_orders.sql`

Independent of `0008_pgmq.sql` (Phase 3); can be applied without it. Follows the house conventions in
[`03-DATABASE.md`](./03-DATABASE.md): `tenant_id` on every row, enum for the closed status set, RLS via
`user_can_access_tenant`, service-role writes.

```sql
create type order_status as enum ('pending','confirmed','cancelled','fulfilled');

create table public.orders (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  session_id        uuid references public.chat_sessions(id) on delete set null,
  status            order_status not null default 'confirmed',
  customer_name     text,
  customer_phone    text,
  customer_address  text,
  items             jsonb not null default '[]'::jsonb,   -- [{ name, qty, price?, sku?, customization? }]
  notes             text,
  platform          platform,
  external_user_id  text,
  owner_notified_at timestamptz,                          -- set once the owner push succeeds (§4)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index orders_tenant_created_idx on public.orders (tenant_id, created_at desc);
create index orders_status_idx        on public.orders (tenant_id, status);

alter table public.orders enable row level security;
create policy orders_select on public.orders
  for select to authenticated using (public.user_can_access_tenant(tenant_id));
-- INSERT/UPDATE via service role only (bypasses RLS), matching usage_logs. No authenticated write
-- policy in Phase 2 unless manual order entry from the dashboard is wanted.

alter publication supabase_realtime add table public.orders;   -- live Orders tab
```

Plus a companion migration `0010_orders_tenant_cols.sql` (or folded in) adding the per-tenant config:

```sql
alter table public.tenants add column if not exists orders_enabled       boolean not null default false;
alter table public.tenants add column if not exists owner_notify_whatsapp text;      -- owner's WA number, E.164
alter table public.tenants add column if not exists owner_notify_template text;      -- approved template name (§4)
```

Add an `orders` `set_updated_at` trigger (reuse the pattern in `0007_triggers.sql`). After applying,
regenerate `src/types/database.ts` and extend the `Tenant` domain type in `types/domain.ts` with
`ordersEnabled`, `ownerNotifyWhatsapp`, `ownerNotifyTemplate`.

### 3.2 `services/orders.ts` + domain type

- `Order` domain type (façade over the generated row, like `Tenant`).
- `orders.create(input)` — service-role insert; returns the new row. `tenant_id` comes from the caller
  (the executor's `ctx`), never from untrusted args.
- `orders.recentDuplicate(sessionId, fingerprint)` — idempotency helper (§6).

### 3.3 `create_order` tool (`services/tools/createOrder.ts`)

```ts
// def.parameters (JSON Schema shown to the model):
{
  items: [{ name: string, qty: integer, customization?: string, price?: number }],  // required, >=1
  customer_name: string,
  customer_phone: string,
  customer_address: string,
  notes?: string,
}
// execute(args, ctx):
//   1. zod-validate args
//   2. idempotency check (§6)
//   3. orders.create({ tenantId: ctx.tenant.id, sessionId: ctx.session.id,
//                      platform: ctx.session.platform, externalUserId: ctx.session.externalUserId, ...args })
//   4. fire owner notification (§4) — best-effort, does not block the reply
//   5. return { orderId, status: 'confirmed' }  → model uses this to confirm to the customer
```

The model must **only** call this after the customer has explicitly confirmed (enforced by the order-flow
system-prompt block, §5).

### 3.4 Dashboard Orders view (live + history, agency and client)

New `/admin/orders` page, always-on and running **alongside** the WhatsApp push (§4) — it is not a
fallback, both fire on every order.

- **Live orders:** subscribe to `orders` via `postgres_changes` (same mechanism as the Live Inbox — RLS
  scopes rows automatically), so a new order appears instantly, in real time, while the operator also
  watches the live chat inbox. Aim for a layout where **live orders and the live chat can be viewed
  simultaneously** (e.g. Orders as its own tab, and/or an orders side-panel on the Inbox, and/or a
  realtime "new order" toast) so the operator sees an order land in the same moment as the conversation
  that produced it. Each order row links to its originating `session_id` so one click jumps to that chat.
- **Order history:** the same page also lists past orders — a normal paginated query on `orders`
  (`order by created_at desc`, filterable by status/date), not just the realtime feed. Detail view shows
  full items, customer name/phone/address, status, platform, and notification state
  (`owner_notified_at`).
- **Client (tenant-admin) access:** the `orders_select` RLS policy uses `user_can_access_tenant(tenant_id)`
  (§3.1), which already covers **both** the agency `platform_admin` *and* a tenant member — so when
  Phase-2 client logins go live ([07-PHASES.md](./07-PHASES.md) — "activate `user_tenants` roles"), a
  logged-in client sees **only their own** live orders and order history with **no policy change**. The
  only remaining work is routing: `/admin` is currently gated to `is_platform_admin`
  ([app/admin/layout.tsx:27](../src/app/admin/layout.tsx)); once client logins are enabled, the Orders page
  must be reachable by tenant admins too (the data layer already enforces the scoping).

### 3.5 Client-facing manual kill switch (rides on the same login unlock)

**Requirement (2026-07-10):** a logged-in client must have the manual **Take Over / kill switch** (and
manual reply) for their *own* conversations — the same per-conversation, cross-platform AI mute the
agency has today.

The mechanism and data layer **already support this** — no new code path, no policy rewrite:
- `takeOverAction` / `manualSendAction` ([app/admin/chat/actions.ts](../src/app/admin/chat/actions.ts))
  run under the **RLS** server client (`createSupabaseServerClient`), not the service role.
- `chat_sessions_write` (`for all … using user_can_access_tenant(tenant_id)`,
  [0006_rls.sql:66-70](../supabase/migrations/0006_rls.sql)) and `chat_messages_insert` (same predicate)
  already permit a **tenant member** to toggle `is_human_handoff` and insert a manual reply on **their
  own** sessions only.

So the client kill switch unlocks with the **identical routing change** as the client Orders view: admit
tenant members past the `is_platform_admin` gate ([app/admin/layout.tsx:27](../src/app/admin/layout.tsx))
into a tenant-scoped dashboard. One change delivers **Live Inbox + kill switch + manual send + Orders**
to the client at once, each auto-scoped by RLS to their tenant. This is Phase-2 "client-facing logins"
work ([07-PHASES.md](./07-PHASES.md)); it is independent of the tool-calling/orders build (A–C) and can
land before or after it.

---

## 4. Stage C — Notifications

### 4.1 Owner notification — WhatsApp template (`services/meta/send.ts`)

The owner is **not** in a chat thread, so we message their own WhatsApp number from the tenant's
business number. Add `sendTemplate()` beside the existing `sendText()`:

```ts
// WhatsApp: POST {GRAPH}/{version}/{phone_number_id}/messages
// { messaging_product:'whatsapp', to: owner_number, type:'template',
//   template: { name: owner_notify_template, language:{code}, components:[{ type:'body',
//               parameters: [{type:'text', text: <order summary fields>}] }] } }
```

Called by the `create_order` executor after insert; on success set `orders.owner_notified_at`. Failures
are logged (metadata only) and never block the customer reply — the order is already persisted and
visible in the dashboard.

### 4.2 The hard constraint — 24-hour window + template approval

WhatsApp Business Platform forbids free-form business-*initiated* messages outside a 24-hour
customer-service window. Since the owner hasn't messaged the business number, the order notification
**must be a pre-approved template** (e.g. `new_order_alert` with body params for customer name / items /
address). This is a **Meta approval step (ops, not code)** and gates go-live for this feature the same
way Business verification gates channel go-live ([06-INTEGRATIONS.md:48-50](./06-INTEGRATIONS.md)). The
code is ready before the template is approved; `owner_notify_template` holds the approved name.

### 4.3 Customer confirmation — reuse `sendText()`

The customer *is* in an open 24-hour window (they just messaged), so their confirmation is free-form and
uses the existing `sendText()` on their own channel — no new dependency, no customer email needed. In
practice the model's final text turn *is* the confirmation ("Thanks Ayesha, your order for 2 phone cases
is confirmed — we'll deliver to …"), dispatched by the orchestrator's normal step 13.

### 4.4 SMS fallback

If template approval is undesirable, an SMS provider (Twilio) can notify the owner instead: add a
`services/notify/sms.ts` leaf service + `TWILIO_*` env, and call it from the executor in place of
`sendTemplate()`. Same executor seam; different transport.

---

## 5. The conversational order flow (where the system prompt still matters)

Tool-calling does the *doing*; a per-tenant **order-flow block** appended to the system prefix drives the
*conversation*. `promptBuilder.buildSystemPrefix` gains an optional trailing block, added only when
`tenant.orders_enabled` (kept out of the cache-critical section only if it varies; since it's static per
tenant it stays cache-safe):

```
## ORDER FLOW
When a customer wants to place an order:
1. Help them choose items from the CATALOGUE (never invent items/prices).
2. Collect: delivery name, full address, and contact phone — one or two at a time, conversationally.
3. Read the COMPLETE order back (items + qty + name + address + phone) and ask them to confirm.
4. ONLY after they explicitly confirm, call the create_order tool with the collected details.
5. After the tool returns, confirm to the customer with the order id and a friendly closing.
Never call create_order before the customer has confirmed. If unsure or the request is out of scope,
use [HUMAN_HANDOFF].
```

This is the honest boundary: the prompt runs the interview and the confirmation gate; the **tool** is
what actually captures data and fires notifications. Neither works without the other.

---

## 6. Cost, idempotency & abuse

- **Metering:** every loop round writes a `usage_logs` row (existing pattern) — a single customer
  message may produce 2–3 rows. Correct and expected.
- **Idempotency:** before insert, `create_order` computes a fingerprint (session + normalised items +
  customer fields) and skips if an identical order exists within a short window (guards double-fire on a
  retried/duplicated turn).
- **Order cap:** a per-session/per-window cap (constant) prevents a runaway or malicious session from
  spamming orders; over the cap → return a structured error to the model and/or `[HUMAN_HANDOFF]`.
- **Loop cap:** `MAX_TOOL_ROUNDS` bounds tool rounds per message.

---

## 7. Stage D — Image / vision (DEFERRED — design sketch only)

> **Superseded by [`10-CUSTOM-ORDERS-MEDIA-AND-INTAKE.md`](./10-CUSTOM-ORDERS-MEDIA-AND-INTAKE.md)**
> (Opus, 2026-07-16), which is the full design pass this sketch asked for — and extends it to voice +
> video, the client intake wizard, and the per-tenant approval toggle. The sketch below is kept for
> history; build from doc 10.

Not built in this pass. Captured so it isn't lost; needs its own `[OPUS]` design before implementation.
Driving case: a phone-case client whose customers DM a screenshot of an Instagram catalogue post and say
"I want this design, with my name on it."

Capability gaps (the pipeline is text-only end to end today):
1. **Carry the image:** extend `InboundMessage` with `attachments?: { type:'image'; mediaId?; url? }[]`
   and stop [`parse.ts`](../src/services/meta/parse.ts) dropping attachment messages (currently
   line ~114). WhatsApp gives an authenticated **media id** (fetch via `/{media-id}` + token);
   Messenger/IG give a **time-limited CDN url** — different handling per product.
2. **Media service** (`services/meta/media.ts`): download the image with the tenant's token, persist to
   a tenant-scoped **Supabase Storage** bucket so the owner can see what was ordered; the order item
   gets an `image_ref`.
3. **Multimodal LLM:** extend `LlmMessage.content` to `string | ContentPart[]`
   (`{type:'text'} | {type:'image_url'}`) — additive union — and call a **vision-capable** model
   (`gpt-4o-mini` supports vision; **most OpenRouter `:free` models do not**, so this client likely needs
   a cheap paid vision call). The model matches the screenshot against the catalogue, then runs the same
   §5 order flow with the customisation captured into the order.

---

## 8. Acceptance criteria

- [ ] A tenant with `orders_enabled=false` behaves exactly as today (no tools advertised, one-shot reply).
- [ ] A customer can pick catalogue items in chat, give name/address/phone, and on confirmation a row
      lands in `orders` with the correct `tenant_id`, `platform`, and contents.
- [ ] `create_order` cannot write to a tenant other than the session's tenant, even if the model emits a
      different id in its args (verified by test).
- [ ] Invalid tool args produce a structured error the model recovers from — never a 500 in `after()`.
- [ ] A retried/duplicated inbound turn does not create a duplicate order.
- [ ] On a new order, **both** fire: the row appears live in `/admin/orders` (realtime, RLS-scoped) **and**
      the owner gets the WhatsApp push — the dashboard is not a fallback for the push.
- [ ] The operator can watch live orders and the live chat inbox at the same time; an order row links to
      its originating chat session.
- [ ] `/admin/orders` also lists **order history** (paginated, filterable), with a detail view showing
      full customer + item data and notification state.
- [ ] A tenant member (Phase-2 login) sees only their own tenant's orders/history — verified by the RLS
      two-tenant test, with no policy change.
- [ ] A logged-in client can flip the manual kill switch (Take Over) and send a manual reply on **their
      own** conversations only, and cannot touch another tenant's sessions — verified by the same
      two-tenant test, with no policy change (§3.5).
- [ ] The owner receives the WhatsApp template notification (once a template is approved); on send
      failure the order is still saved, still shown in the dashboard, and the customer still gets confirmed.
- [ ] The customer receives a confirmation on their own channel.
- [ ] No secret/token appears in any tool result, log, or client bundle.

---

## 9. Build order for Sonnet

1. **A1** — extend `provider.ts` interfaces (§2.1); update `openai.ts` + `openrouter.ts` message/tool
   mapping (§2.2). Typecheck green; existing text path unchanged.
2. **A2** — add `MAX_TOOL_ROUNDS` to `constants.ts`; convert `aiOrchestrator` to the bounded loop (§2.3).
3. **A3** — `services/tools/registry.ts` (`ToolExecutor`, `getEnabledTools`, `executeTool`) with the
   security invariants (§2.5). Empty registry ⇒ no behavioural change yet.
4. **B1** — migrations `0009` + `0010` (§3.1); regenerate `database.ts`; extend `Tenant` domain type.
5. **B2** — `services/orders.ts` (§3.2) and the `create_order` executor (§3.3); register it in
   `getEnabledTools` behind `orders_enabled`.
6. **B3** — `/admin/orders` realtime tab (§3.4).
7. **C1** — `sendTemplate()` in `services/meta/send.ts` (§4.1); wire owner-notify into the executor.
8. **C2** — order-flow system-prompt block in `promptBuilder` (§5).
9. **Ops (parallel, not code):** submit the WhatsApp `new_order_alert` template for Meta approval.

`[OPUS]` before Stage D: the image/vision design pass (§7).
