# 01 — Architecture

## 1. What CrewNest is, in one diagram

```
                         ┌──────────────────────────────────────────────┐
   Customers             │                  CrewNest                     │
                         │             (Next.js 16 on Vercel)            │
 WhatsApp ─┐             │                                                │
 FB DM ────┤  webhooks   │  app/api/webhooks/meta   ─┐                    │
 IG DM ────┼───────────► │  app/api/webhooks/shopify │  fast ACK (<1s)    │
 Website ──┘  widget     │  app/api/chat (widget)    ─┘  then after():    │
                         │                              │                 │
                         │                     services/aiOrchestrator    │
                         │                              │                 │
                         │        ┌─────────────────────┼──────────────┐  │
                         │        ▼                      ▼              ▼  │
                         │   LLMProvider          Supabase (RLS)   Meta Graph
                         │  (OpenAI default)   Postgres/Auth/RT/Vault  send │
                         └────────┼───────────────────┼──────────────────┘
                                  │                    │
                            OpenAI API          ┌──────┴───────┐
                                                │  Dashboard   │  ← agency staff
                                                │ /admin/*     │    (Supabase Auth)
                                                │ live inbox   │
                                                └──────────────┘
```

CrewNest is **one backend** serving **many tenants**. A tenant is identified from the *destination*
of each inbound event (the Meta Page ID / WhatsApp phone-number ID the message arrived on, or the
tenant public key on a website widget request). All of a tenant's config — brand persona
(`system_prompt`), `catalog_data`, provider choice, and encrypted credentials — is loaded at runtime
and used to answer, then the reply is sent back on the same channel.

---

## 2. Runtime & async model (the most important decision)

Meta re-delivers a webhook if you don't ACK quickly, and an LLM turn takes seconds. So **we never do
the AI work before responding.**

**Phase 1 (chosen): Node runtime + `after()`**

1. Webhook route runs on the **Node.js runtime** (`export const runtime = 'nodejs'`) with a raised
   `maxDuration` (e.g. `export const maxDuration = 60`).
2. It verifies the signature, dedupes on the provider message id, writes the inbound row, and
   **returns `200` immediately**.
3. It calls `after(async () => { await handleInboundMessage(...) })` — Next.js keeps the invocation
   alive (via `waitUntil`) to run the AI turn *after* the response is sent.

Why Node and not Edge for Phase 1: the AI turn is multi-second work; Node functions get generous
`maxDuration` on Vercel, all SDKs work, and there is **no queue/worker/cron to deploy**. Edge is
great for a pure fast-ACK, but then you still need a durable consumer — which is Phase 3, not launch.

**Phase 3 upgrade: Edge ACK + pgmq durable queue.** When volume or reliability demands it:
- Webhook (optionally Edge) verifies + dedupes + `pgmq.send()` + returns 200.
- A consumer (Supabase Edge Function on a cron, or a small worker) `pgmq.read()`s and runs the same
  `aiOrchestrator`. **The orchestrator is written trigger-agnostic** so this swap needs no rewrite —
  only the caller changes.

> `after()` is stable since Next 15.1 and supported on Vercel Node/Edge via `waitUntil`. It runs even
> if the handler errored, so all AI-turn errors must be caught inside the callback (see AI pipeline).

---

## 3. Request flows

### 3.1 Inbound customer message → AI reply
```
1. Provider POSTs webhook  →  app/api/webhooks/meta/route.ts (Node)
2. Verify X-Hub-Signature-256 against META_APP_SECRET over the RAW body   [reject if bad]
3. Parse: platform, destination_id (page/phone id), external_user_id, text, provider_msg_id
4. Idempotency: INSERT provider_msg_id into webhook_events (unique)       [dup → 200, stop]
5. Return 200 NOW.
6. after(): handleInboundMessage():
   a. serviceClient resolves tenant by destination_id  (is_active = true)
   b. find/create chat_session (tenant_id + platform + external_user_id)
   c. if session.is_human_handoff → persist user msg, DO NOT auto-reply, stop
   d. persist user msg → chat_messages
   e. load short-term memory (last N msgs, token-budgeted)
   f. build cache-ordered payload: [system_prompt + catalog_data] ++ history ++ new msg
   g. decrypt tenant LLM key from Vault in memory → call LLMProvider → drop key
   h. if reply contains [HUMAN_HANDOFF] → set session flag, strip token, skip send
   i. persist assistant msg + usage_logs row
   j. send reply via Meta Graph using tenant's decrypted page/WA token
```

### 3.2 Website chat message → AI reply
Same as 3.1 but the entry point is `app/api/chat/route.ts`. Tenant is resolved by a **public tenant
key** in the request; origin is checked against the tenant's allowed domains; per-session rate limits
apply. No X-Hub signature (different threat model — see security doc).

### 3.3 Agency dashboard (live inbox)
```
Staff browser ──(Supabase Auth cookie)──► /admin/chat (server component gate)
   client component subscribes: supabase.channel().on('postgres_changes', {table:'chat_messages'})
   Realtime delivers only rows the user's RLS allows (platform_admin = all; tenant member = theirs)
   "Take Over" toggle → server action → UPDATE chat_sessions.is_human_handoff = true
   Manual send → server action → insert assistant msg + Meta Graph send (server-side)
```

---

## 4. Multi-tenant routing

There is **no per-tenant deployment**. Isolation is enforced at the data layer by RLS and at the
routing layer by destination lookup:

- **Meta:** one Meta App → one webhook URL. Each inbound entry carries the Page ID (FB/IG) or
  phone-number ID (WhatsApp). We map that to a `tenant` row (`meta_page_id` /
  `whatsapp_phone_number_id`, both indexed). Unknown/inactive destination → ignore.
- **Website:** the widget sends the tenant's **public key**; we map to the tenant and verify origin.

The **service-role** client (used only in webhook/`after()` context, never in the browser) performs
these lookups. Everything a *signed-in dashboard user* does goes through an **RLS-scoped** client so
Postgres itself enforces tenant boundaries.

---

## 5. Directory layout (target)

```
src/crewnest/
├── docs/                          # these specs (source of truth)
├── supabase/
│   └── migrations/                # runnable SQL (schema, RLS, Vault helpers)
├── proxy.ts                       # Next 16 "middleware": optimistic auth redirect only
├── src/
│   ├── app/
│   │   ├── (marketing)/           # public landing (later)
│   │   ├── (auth)/login/          # Supabase Auth sign-in
│   │   ├── admin/                 # DASHBOARD (server-gated)
│   │   │   ├── layout.tsx         #   sidebar + server-side session check
│   │   │   ├── page.tsx           #   Overview
│   │   │   ├── clients/           #   Clients list + onboarding wizard
│   │   │   ├── chat/              #   Live Inbox (3-pane realtime)
│   │   │   └── settings/
│   │   └── api/
│   │       ├── webhooks/meta/route.ts
│   │       ├── webhooks/shopify/route.ts     # Phase 2 stub
│   │       ├── webhooks/voice/route.ts       # Phase 3 stub
│   │       └── chat/route.ts                 # website widget endpoint
│   ├── services/
│   │   ├── aiOrchestrator.ts      # the brain (trigger-agnostic)
│   │   ├── ai/
│   │   │   ├── provider.ts        # LLMProvider interface + factory
│   │   │   ├── openai.ts          # default provider
│   │   │   └── promptBuilder.ts   # cache-ordered message assembly
│   │   ├── meta/
│   │   │   ├── signature.ts       # X-Hub-Signature-256 verify (Web Crypto)
│   │   │   └── send.ts            # Graph API outbound
│   │   ├── tenants.ts             # resolve tenant by destination / public key
│   │   ├── sessions.ts            # find/create sessions, handoff flag
│   │   ├── messages.ts            # persist + memory window
│   │   └── security/
│   │       ├── sanitize.ts        # prompt-injection guardrails
│   │       └── rateLimit.ts       # widget rate limiting
│   ├── lib/
│   │   ├── env.ts                 # validated env access (server-only)
│   │   ├── secrets.ts             # Vault read/write helpers (service role)
│   │   └── supabase/
│   │       ├── server.ts          # RLS client for RSC/actions (cookie-bound)
│   │       ├── service.ts         # service-role client (SERVER ONLY, never imported client-side)
│   │       └── browser.ts         # anon client for realtime subscriptions
│   ├── types/
│   │   └── database.ts            # generated Supabase types + domain types
│   └── components/                # shadcn/ui + dashboard components
└── public/embed/widget.js         # website chat widget (self-contained)
```

---

## 6. Deployment topology

- **Vercel** hosts the Next.js app. Webhook routes = Node runtime. Env vars set in Vercel project
  settings (never in the repo).
- **Supabase** hosts Postgres (schema + RLS + Vault), Auth, and Realtime. Migrations applied via the
  Supabase CLI or SQL editor.
- **DNS:** the Meta webhook callback URL points at `https://<app>/api/webhooks/meta`. Each client's
  website loads `https://<app>/embed/widget.js`.
- **Secrets at runtime:** `after()`/webhook code reads the master keys from `process.env` and
  per-tenant keys from Vault via the service-role client. Decrypted keys live only in function memory
  for the duration of one request.

See [`02-SECURITY.md`](./02-SECURITY.md) for the trust boundaries and [`03-DATABASE.md`](./03-DATABASE.md)
for the schema and RLS that make multi-tenancy safe.
