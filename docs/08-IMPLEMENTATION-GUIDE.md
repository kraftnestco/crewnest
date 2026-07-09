# 08 — Implementation Guide (for Sonnet)

Build in this order. Each step says **what to create**, **key details**, and **done when**. Interface
stubs already exist under `src/` with `TODO(sonnet)` markers — fill the bodies; don't redesign the
signatures (they encode locked decisions). Steps tagged **`[OPUS]`** → ask the user to switch to Opus.

> **Before writing any Next.js code, read §0. This is Next.js 16 — several APIs differ from Next-15
> training data and will silently break if you use old patterns.**

---

## §0. Next.js 16 cheat-sheet (READ FIRST)

| Topic | Next 16 reality | Do this |
|-------|-----------------|---------|
| **Middleware** | Renamed to **Proxy**. File is `proxy.ts` (root or `src/`), exports `proxy` (named or default). `config.matcher` still works. | Put optimistic auth redirect in `src/proxy.ts`. **Not** `middleware.ts`. |
| **Proxy scope** | Docs explicitly say proxy is **not** for auth/session or slow fetches. | Optimistic redirect only; real auth in server components/actions via `auth.getUser()`. |
| `cookies()` / `headers()` | **async** — must `await`. | `const c = await cookies()`. Wire into `@supabase/ssr` server client. |
| `params` / `searchParams` | **Promises** in pages/layouts. | `const { id } = await params`. |
| Route handlers | `route.ts` with `GET/POST` exports; **not cached** by default. Raw body available via `await req.text()`/`req.arrayBuffer()`. | Read raw body for signature BEFORE parsing JSON. |
| `RouteContext` | Global helper type; `ctx.params` is a Promise. | `export async function GET(_req: NextRequest, ctx: RouteContext<'/x/[id]'>) { const {id} = await ctx.params }` |
| **`after()`** | Stable. `import { after } from 'next/server'`. Runs post-response (via `waitUntil`), even on error. | Use for the AI turn after ACK. Set `export const maxDuration = 60`. |
| Runtime | `export const runtime = 'nodejs' | 'edge'` per route. Edge lacks Node APIs but has Web Crypto. | Webhooks = `'nodejs'` in Phase 1 (see architecture §2). |
| Cache Components | Opt-in `cacheComponents` + `use cache`; otherwise routes are dynamic by default. | Dashboard reads are dynamic (realtime data) — fine. Don't fight it. |
| Tailwind | **v4**: CSS-first. `@import "tailwindcss";` in `globals.css`. **No `tailwind.config.js`** by default; theme via `@theme`. | Configure shadcn for Tailwind v4. Don't create a v3 config. |
| Turbopack | Default bundler. | No action; avoid webpack-only plugins. |

When unsure about a Next 16 API, read the bundled docs at
`node_modules/next/dist/docs/01-app/...` (authoritative for the installed version) or use context7
(`/vercel/next.js`). Do **not** rely on memory for Next 16 specifics.

---

## §1. Foundation

**1.1 Install dependencies**
```
npm i @supabase/supabase-js @supabase/ssr openai zod server-only
npx shadcn@latest init      # choose Tailwind v4 / CSS variables
```
Add a few shadcn components up front: `button input textarea label dialog card badge scroll-area
switch sonner tabs table`.
**Done when:** `npm run build` still passes and shadcn components import.

**1.2 `lib/env.ts`** — validated, server-only env access. Zod schema for `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MASTER_OPENAI_KEY`, `META_APP_SECRET`,
`META_VERIFY_TOKEN`, `META_GRAPH_VERSION`. Export a typed `env`. Throw on missing at startup.
Mark server secrets so they're never bundled (only `NEXT_PUBLIC_*` may reach the client).
**Done when:** importing `env` in a server file typechecks; a missing var throws a clear error.

**1.3 `.env.example`** already scaffolded — keep it in sync with `env.ts`. Ensure real `.env.local`
stays git-ignored (the `.gitignore` was fixed to keep `.env.example` only).

---

## §2. Database  `[OPUS]` for RLS/Vault review

**2.1** In the Supabase dashboard, enable the **Vault** extension and **pgcrypto**. (pgmq only in
Phase 3.)

**2.2** Apply migrations `supabase/migrations/0001`–`0007` in order (Supabase SQL editor or
`supabase db push`). They're written already per [`03-DATABASE.md`](./03-DATABASE.md).

**2.3 `[OPUS]`** Review the RLS policies and Vault grants against the SECURITY audit checklist —
especially that `anon`/`authenticated` cannot read `vault.decrypted_secrets` or execute the `private`
secret functions, and that two-tenant isolation holds.

**2.4** Generate types: `npx supabase gen types typescript --project-id <id> > src/types/database.ts`
(replace the stub). 
**Done when:** types compile and reflect all tables/enums.

---

## §3. Supabase clients

- **3.1 `lib/supabase/server.ts`** — `createServerClient` from `@supabase/ssr`, bound to
  `await cookies()`. For RSC/server actions. RLS-scoped (uses the signed-in user's JWT).
- **3.2 `lib/supabase/service.ts`** — starts with `import 'server-only'`. `createClient` with
  `SUPABASE_SERVICE_ROLE_KEY`, no session persistence. **Bypasses RLS**; used only by webhook/`after()`
  code. Never import from a client component.
- **3.3 `lib/supabase/browser.ts`** — `createBrowserClient` with the anon key, for realtime
  subscriptions in client components.
**Done when:** a server component can read a table as the user; the service client can read across
tenants; the browser client can open a realtime channel.

---

## §4. AI core  `[OPUS]` for promptBuilder + guardrails

- **4.1 `services/ai/provider.ts`** — the interface + `getProvider()` factory (stub exists).
- **4.2 `services/ai/openai.ts`** — implement `chat()` with the OpenAI SDK, `gpt-4o-mini`, normalised
  usage. Key passed in as an argument (never read from env here).
- **4.3 `services/ai/pricing.ts`** — model→rate table; `estimateCostUsd(usage, model)`.
- **4.4 `[OPUS]` `services/ai/promptBuilder.ts`** — assemble the cache-ordered array exactly as
  [`05-AI-PIPELINE.md`](./05-AI-PIPELINE.md) §2. Deterministic catalogue serialisation. Include
  `GUARDRAIL_RULES`.
- **4.5 `services/security/sanitize.ts`** — strip control chars, cap length, neutralise injection /
  control-token look-alikes.
**Done when:** a unit test shows the message array is `[system(prefix)] ++ history ++ user`, prefix
byte-identical across two calls with different user text.

---

## §5. Domain services

- **5.1 `services/tenants.ts`** — `resolveByDestination({platform, destinationId})` and
  `resolveByWidgetKey(key)` using the **service** client; `is_active` filter.
- **5.2 `services/sessions.ts`** — `findOrCreate`, `setHandoff`, `resumeAi`.
- **5.3 `services/messages.ts`** — `persist(role, content, ...)`, `loadWindow(sessionId, budget)`.
- **5.4 `lib/secrets.ts`** — `getLlmKey(tenant)`, `getMetaToken(tenant)` via the `private.get_tenant_secret`
  RPC on the service client; `setTenantSecret()` for onboarding. Never log return values.
**Done when:** each function has a focused signature matching the stubs and a happy-path test.

---

## §6. Orchestrator

**6.1 `services/aiOrchestrator.ts`** — implement `handleInboundMessage()` per
[`05-AI-PIPELINE.md`](./05-AI-PIPELINE.md) §1, calling the services above. Keep it **trigger-agnostic**
(no `next/server` imports) so a pgmq consumer can call it later. Wrap work in try/catch; log metadata
only.
**Done when:** calling it with a fake inbound (mocked provider) creates session+messages+usage and
returns the reply; handoff short-circuits; `[HUMAN_HANDOFF]` sets the flag and suppresses send.

---

## §7. Meta channel

- **7.1 `services/meta/signature.ts`** — `verifyMetaSignature(rawBody, header, appSecret)` using Web
  Crypto `crypto.subtle` HMAC-SHA256, constant-time compare.
- **7.2 `services/meta/parse.ts`** — normalise Messenger/IG/WhatsApp payloads → `InboundMessage[]`.
- **7.3 `services/meta/send.ts`** — `sendText({tenant, platform, to, text})` to Graph API, decrypting
  the token in memory.
- **7.4 `app/api/webhooks/meta/route.ts`** — `runtime='nodejs'`, `maxDuration=60`. `GET` verify; `POST`
  raw-body → verify → parse → dedupe (`webhook_events`) → **200** → `after(() => handleInboundMessage)`.
**Done when:** GET handshake echoes challenge; POST with valid signature ACKs then replies; bad
signature → 401; duplicate id → single reply.

---

## §8. Website widget

- **8.1 `services/security/rateLimit.ts`** — simple per-key/IP limiter (in-memory for dev; note a
  Redis/Upstash upgrade for multi-instance).
- **8.2 `app/api/chat/route.ts`** — `runtime='nodejs'`. Resolve tenant by public key, check origin
  allowlist + rate limit, run `aiOrchestrator`, return the reply (stream optional). Scope CORS to the
  origin.
- **8.3 `public/embed/widget.js`** — self-contained launcher+panel; reads `data-crewnest-key`; POSTs
  to `/api/chat`; persists `sessionKey`.
**Done when:** a local test HTML with the script gets replies; a disallowed origin is rejected.

---

## §9. Dashboard

- **9.1 `src/proxy.ts`** — optimistic redirect to `/login` when no Supabase auth cookie on `/admin/*`
  (matcher). Nothing security-critical here.
- **9.2 `app/(auth)/login/page.tsx`** — Supabase Auth (email magic-link or password). On success,
  redirect to `/admin`.
- **9.3 `app/admin/layout.tsx`** — **server component**: `await supabase.auth.getUser()`; if none →
  redirect; load `profiles.is_platform_admin`; render sidebar (Overview, Clients, Live Inbox,
  Settings). This is the real gate.
- **9.4 `app/admin/page.tsx`** — Overview: counts (tenants, active sessions, handoffs), recent usage.
- **9.5 `app/admin/clients/*`** — table of tenants + **onboarding wizard** (`dialog`): business name,
  slug, Meta ids, system prompt (textarea), catalogue JSON (textarea/upload), masked BYOK key + Meta
  tokens. Submit via **server action** → insert tenant + `setTenantSecret()` for each secret. Mask on
  display (`••••`).
- **9.6 `app/admin/chat/*`** — **Live Inbox** (client components under a server gate):
  - Left: sessions list (subscribe to `chat_sessions` changes); unread/new bump to top; red row when
    `is_human_handoff`.
  - Middle: message history (subscribe to `chat_messages` for the open session); user vs assistant
    styling.
  - Right: tenant catalogue view + **Take Over** `switch` (server action toggles `is_human_handoff`) +
    manual send input (server action inserts assistant message + `meta.send`).
  - Realtime: `browser.ts` client, `.channel().on('postgres_changes', ...)`. RLS already filters what
    arrives.
**Done when:** login gates `/admin`; onboarding creates a tenant with secrets in Vault; inbox updates
live; Take Over mutes AI; manual send delivers.

---

## §10. Stubs to leave as-is (Phase 2/3)
- `app/api/webhooks/shopify/route.ts` → verify HMAC, `501` TODO body.
- `app/api/webhooks/voice/route.ts` → `501` placeholder.
- `services/ai/anthropic.ts` → optional; if a tenant needs Claude, **load the `claude-api` skill**
  before implementing.

---

## §11. Verify before calling it done
- Run the SECURITY **Audit Checklist** ([`02-SECURITY.md`](./02-SECURITY.md) §9).
- Run the Phase-1 **Acceptance Criteria** ([`07-PHASES.md`](./07-PHASES.md)).
- `npm run build` + typecheck clean; lint clean.
- Manual end-to-end: one real Meta test message and one widget message produce grounded replies; a
  second tenant proves isolation.

---

## When to switch to Opus (summary)
1. **RLS policies + Vault grants** review/changes (§2.3).
2. **`promptBuilder` + guardrail system text** (§4.4).
3. **Meta payload normaliser** if shapes are fighting you (§7.2).
4. Phase 2: **tool-calling security**, **billing/quota logic**.
5. Phase 3: **pgvector RAG design**, **queue delivery guarantees**.
Everything else is safe for Sonnet with these docs + the stubs.
