# CrewNest — Session Handoff

**Purpose of this file:** continuity doc for the next chat session on this project. Read this first,
then `CLAUDE.md`/`AGENTS.md` (how-we-work rules) and `docs/` (source of truth for architecture).
This file is a **snapshot of one working session**, not a locked spec — update or delete stale sections
as the project moves past them.

---

## 1. Goals (this session)

1. Get CrewNest into a demoable state for prospective clients (AI chat automation specifically).
2. Understand and confirm real capabilities: Meta channel integration model, Live Inbox scope, the
   "Human takeover" kill switch, and whether they're real or stubbed.
3. Answer a product question honestly: can an order-taking flow (catalogue navigation → customer info
   collection → order confirmation → owner/customer notification), including a phone-case-customization
   Instagram-DM-screenshot use case, be built by **just changing system prompts** — or does it need real
   feature work?
4. Design that feature properly (Opus session, since it touches locked interfaces).
5. Add a client-facing manual kill switch to the same design.
6. Get a real Instagram account connected for live testing right now.
7. **This file** — a handoff so a new chat can resume with full context.

---

## 2. Current state (as of this session)

- **Stack confirmed unchanged from `CLAUDE.md`:** Next.js 16.2.10 + Supabase (real project
  `juknslsaalykuzifieur`, live). Real Supabase Auth/RLS/Vault in place.
- **Demo Cafe tenant** is fully working end-to-end: widget embedded at `public/demo.html`, running on
  the free-tier OpenRouter provider (`llm_provider='openrouter'`, `llm_model='tencent/hy3:free'`), with
  a corrected `system_prompt` that actually states real opening hours (fixes a handoff-guardrail bug —
  see §5). Verified via both `curl` and a full Playwright browser round-trip.
- **`.env.local` status:** `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, `MASTER_OPENROUTER_KEY`
  are **real**. `MASTER_OPENAI_KEY`, `META_APP_SECRET`, `META_VERIFY_TOKEN` are **still placeholders** —
  real OpenAI and real Meta channel testing are both blocked on this until replaced.
  ⚠️ **Never print the real `MASTER_OPENROUTER_KEY` value in chat or write it to memory/docs — reference
  it only by variable name.** It lives only in the gitignored `.env.local` (confirmed via
  `git check-ignore -v .env.local`).
- **Order-taking / tool-calling feature: fully designed, zero implementation.** Full spec at
  [`docs/09-ORDERS-AND-TOOLS.md`](docs/09-ORDERS-AND-TOOLS.md) (written this session, Opus). Nothing in
  that doc has been built yet — no migrations applied, no provider interface changes made, no tools
  registry exists.
- **Client-facing kill switch: confirmed already works at the data layer, gated by one line.** No code
  changes made — this is a finding, documented in `docs/09` §3.5 (see §7 below).
- **Real Instagram connection: guidance given, not yet executed.** No ngrok tunnel set up, no confirmed
  real Meta App, no real `META_APP_SECRET`/`META_VERIFY_TOKEN`, no tenant configured with a real
  `instagram_id`/token. See §8 for the exact checklist to pick back up.

---

## 3. Changes made this session (files touched)

| File | Change |
|---|---|
| `.env.local` | Added real `MASTER_OPENROUTER_KEY` below the still-placeholder `MASTER_OPENAI_KEY`. |
| `src/lib/env.ts` | Added `MASTER_OPENROUTER_KEY: z.string().optional()` to the env schema. |
| `src/lib/secrets.ts` | `getLlmKey()` made provider-aware: branches on `tenant.llmProvider === 'openrouter'` to fall back to `MASTER_OPENROUTER_KEY` instead of always falling back to the OpenAI master key. |
| `src/services/ai/openrouter.ts` | **New file.** OpenRouter `LlmProvider` implementation — reuses the `openai` SDK with `baseURL: 'https://openrouter.ai/api/v1'`. |
| `src/services/ai/provider.ts` | Registered `openrouter` in the `getProvider()` factory switch. |
| `public/demo.html` | **New file.** Standalone "Demo Cafe" landing page with the real widget embedded (`data-crewnest-key="wk_04103e9139f198b3b2d1041b9371ef9f"`), reachable at `/demo.html`. |
| Demo Cafe tenant row (Supabase, via temp scratch scripts, deleted after use) | Set `llm_provider`/`llm_model` to openrouter/`tencent/hy3:free`; updated `system_prompt` to state real hours (Mon–Sat 7am–6pm, closed Sundays). |
| `docs/09-ORDERS-AND-TOOLS.md` | **New file.** Full Opus-designed spec for tool-calling + orders + notifications + client kill switch. See §7. |

No other source files were modified. No migrations were applied. No `LlmRequest`/`InboundMessage`
interface changes were actually made yet — those are **designed, not built** (see `docs/09`).

---

## 4. What worked (repeat these patterns)

- **Ground every architecture claim in the actual code before answering.** Every "can this be done via
  system prompt alone?" or "is the kill switch real?" question was answered by reading the actual
  source (`aiOrchestrator.ts`, `provider.ts`, `admin/chat/actions.ts`, `meta/send.ts`, the RLS migration)
  — not from memory of what was "probably" built. This caught real gaps (no `tools` field, no image
  support, no `orders` table) and real non-gaps (the kill switch and manual-send dispatch were already
  fully real, not stubs).
- **`curl` before browser.** Direct `POST /api/chat` calls verified the AI pipeline faster than a full
  Playwright round-trip, and caught the handoff-guardrail bug first.
- **Scratch `.mjs` scripts inside `src/crewnest/` for DB reads/writes**, manually parsing `.env.local`
  for Supabase creds, run once, then **deleted immediately** — keeps the repo clean, avoids ESM
  resolution failures (Node resolves `node_modules` relative to the *importing file's* location, not
  `cwd` — a script placed in the OS temp scratchpad failed to find `@supabase/supabase-js` for exactly
  this reason).
- **`AskUserQuestion` for direction/scope forks**, not just tool permissions — used for: bank-vs-scope-now
  on the order feature, owner-notify channel (dashboard/email/WhatsApp), vision-now-vs-later, and
  spec-doc-vs-no-doc. Produced clean, explicit decisions now baked into `docs/09`.
- **Respecting the project's own Opus/Sonnet split.** When the order-taking design touched locked
  interfaces (`InboundMessage`, `LlmRequest`/`LlmProvider`), work paused and the user was asked to switch
  to Opus — per `CLAUDE.md`'s own `[OPUS]` checkpoint rule — rather than redesigning locked interfaces
  from Sonnet. Switched back to Sonnet afterward for the mechanical/ops Instagram-connection question.
- **`PowerShell Get-ChildItem` as a fallback when the `Glob`/ripgrep tool times out** on this repo (it
  did, repeatedly, this session — see §5). Direct-listing the specific directory worked every time.

---

## 5. Failed strategies & workarounds

| Problem | Fix |
|---|---|
| Diagnostic script queried `instagram_account_id` (doesn't exist). | Correct column is `instagram_id` — confirmed via `docs/03-DATABASE.md`. |
| Diagnostic script placed in the OS temp scratchpad couldn't resolve `@supabase/supabase-js`. | Node's ESM resolver uses the *importing file's* location, not `cwd`. Place the script inside `src/crewnest/` itself. |
| Demo Cafe's own suggested question ("What time do you open?") triggered `[HUMAN_HANDOFF]` instead of answering. | **Not a bug** — the system prompt promised to answer hours questions but never stated actual hours, so the model correctly refused to invent an answer. Fixed by adding real hours to `system_prompt`. |
| A Playwright test session got permanently muted (`is_human_handoff=true`) and stayed muted on reload because the widget persists its session key in `localStorage`. | `page.evaluate(() => localStorage.clear())` before the next test, or use a fresh `sessionKey` directly via `curl`. |
| New `MASTER_OPENROUTER_KEY` wasn't picked up after editing `.env.local`. | `env.ts` validates/caches `process.env` once at module load — **always restart the dev server** after any `.env.local` change. Find the PID on port 3000 (`netstat -ano | grep ":3000" | grep LISTENING`), `taskkill //PID <pid> //F`, restart `npm run dev` in the background. |
| Playwright MCP tool calls failed with "No such tool available" mid-session. | MCP namespace churned (`mcp__playwright__*` ↔ `mcp__plugin_playwright_playwright__*`) after a reconnect. Re-run `ToolSearch` to pick up the currently-live name. |
| `Glob`/ripgrep timed out repeatedly on `src/crewnest/**/*.ts`-style patterns this session. | Use `PowerShell`'s `Get-ChildItem -Path <dir> -File` (optionally `-Recurse`) on a specific directory instead of a broad glob. |

---

## 6. The core product answer this session established

**"Can order-taking + notifications + phone-case screenshot handling be done via system prompt changes
alone?" → No.** Confirmed by reading the actual code:
- `InboundMessage` (`src/types/domain.ts`) is **text-only** — no image/attachment field.
- `LlmRequest`/`LlmProvider` (`src/services/ai/provider.ts`) has **no `tools`/function-calling param** —
  plain text-in/text-out.
- No `orders` table exists anywhere in the schema.
- No email-sending integration exists in the codebase (Resend is available as an MCP connector in this
  environment but is currently **unauthenticated** — would need `/mcp` connection).
- Neither `docs/07-PHASES.md` nor `docs/05-AI-PIPELINE.md` mention orders/notifications/images — this
  is genuinely new scope. (Though `07-PHASES.md` **does** already anticipate tool-calling generally as
  a Phase-2 item — see below.)

A system prompt can drive the *conversation* (catalogue Q&A, asking for name/address turn by turn,
reading back a summary) — but it cannot *persist* structured data or *trigger* side effects (an email,
a DB write). That requires real tool-calling.

---

## 7. The order-taking design — `docs/09-ORDERS-AND-TOOLS.md`

Full spec is in that file; this is the summary for quick recall.

**Mechanism:** tool-calling (the `tool` message role your own `07-PHASES.md` already reserved for
Phase 2), not smarter prompts. The model runs the catalogue interview + confirmation gate via a
per-tenant "ORDER FLOW" system-prompt block, then calls a `create_order` tool that actually persists +
notifies. The orchestrator's current one-shot `provider.chat()` call becomes a **bounded tool loop**
(`MAX_TOOL_ROUNDS`).

**Security invariant (the `[OPUS]` checkpoint):** the model supplies order **contents**; the **server**
supplies `tenant_id` (bound from `ToolContext`, never from the model's arguments) — a model can never
write to another tenant even if it emits a different id.

**Locked decisions (2026-07-10):**
- Owner notified via **dashboard Orders tab AND WhatsApp, together** — not either/or.
- WhatsApp owner-push needs a **Meta-approved template** (business-initiated messages outside the 24h
  window can't be free-form) — this is an **ops approval step, not code**; SMS/Twilio is the documented
  fallback if template approval is undesirable.
- Customer confirmation reuses the existing `sendText()` on their own channel — no customer email needed.
- Dashboard shows **live orders + live chat side-by-side + full order history**.
- **Client (tenant-admin) access to Orders and history needs zero RLS policy change** — the
  `orders_select` policy reuses `user_can_access_tenant(tenant_id)`, which already covers tenant members.
  Only the routing gate needs to open (see next point).
- **Client-facing manual kill switch (added mid-session, §3.5 of the doc): already works at the data
  layer today.** `takeOverAction`/`manualSendAction` (`src/app/admin/chat/actions.ts`) run under the
  RLS-scoped server client, not the service role, and the `chat_sessions_write`/`chat_messages_insert`
  RLS policies (`supabase/migrations/0006_rls.sql`) already permit a tenant member to toggle
  `is_human_handoff` and manually reply **on their own sessions only**. **The only blocker is the binary
  gate** `if (!profile?.is_platform_admin)` at `src/app/admin/layout.tsx:27`. Opening that one gate to
  admit tenant members (Phase-2 client logins) delivers **Live Inbox + kill switch + manual send +
  Orders** to clients all at once, each auto-scoped by RLS — no other code path or policy needed.
- **Text order-taking ships first.** Image/vision (the phone-case Instagram-screenshot case) is
  deliberately **deferred** to its own future Opus design pass — §7 of `docs/09` is a sketch only
  (needs `InboundMessage.attachments`, `parse.ts` no longer dropping attachment messages, a Supabase
  Storage media service, a `string | ContentPart[]` union on `LlmMessage.content`, and a paid
  vision-capable model since free OpenRouter models mostly can't see images).

**Staging (each independently shippable):**
- **A** — tool-calling foundation: provider interface deltas (`tools`, `toolCalls`) + bounded
  orchestrator loop + tool registry + security invariants.
- **B** — orders domain: migrations `0009`/`0010` + `orders` table + `create_order` tool +
  `/admin/orders` realtime + history page.
- **C** — notifications: WhatsApp `sendTemplate()` owner-notify + the ORDER FLOW prompt block.
- **D** — image/vision (deferred, separate Opus pass first).

Full build order + file-by-file steps: `docs/09-ORDERS-AND-TOOLS.md` §9. Acceptance criteria: §8.

**Nothing in stages A–D has been implemented.** Next chat should either (a) switch to Sonnet and start
Stage A mechanically per `docs/09` §9, or (b) scope the client-login/routing unlock as its own small
spec first (it's simpler than A–D and unlocks 4 client-facing features at once).

---

## 8. Real Instagram connection — checklist to resume (not yet executed)

Goal: connect a real Instagram Business/Creator account for live testing, using Development mode (no
Meta App Review needed for testing with your own accounts).

1. Confirm the Instagram account is **Business or Creator**, linked to a Facebook Page (hard Meta
   requirement — personal IG accounts cannot use Graph API messaging at all).
2. Create a Meta App at developers.facebook.com if not already done (free); add Instagram + Messenger
   products; leave it in **Development mode**.
3. Generate a **Page Access Token** via Graph API Explorer with `instagram_basic`,
   `instagram_manage_messages`, `pages_messaging` scopes, for the Page linked to the IG account.
4. **Public HTTPS tunnel required** — `localhost:3000` is not reachable by Meta. Run `ngrok http 3000`
   (or cloudflared) to get a public URL.
5. Register the webhook in the Meta App dashboard: callback = `https://<ngrok-url>/api/webhooks/meta`,
   verify token = the value of `META_VERIFY_TOKEN` in `.env.local` (currently the placeholder
   `dev-verify-token` — this is a secret **you** choose, not one Meta issues, so it's fine to keep it,
   just make it match on both sides). Subscribe to the `messages` field for Instagram.
6. Replace the placeholder `META_APP_SECRET` in `.env.local` with the real value from Meta App →
   Settings → Basic. The webhook route (`src/app/api/webhooks/meta/route.ts`) verifies every request's
   `X-Hub-Signature-256` against this — a wrong value silently 401s every real Meta message.
7. **Restart the dev server** (env is cached at module load; won't pick up `.env.local` changes live).
8. In the dashboard (Clients → New client, or edit a tenant): fill **Instagram account id** (the IG
   *business account* numeric id — get via `GET /{page-id}?fields=instagram_business_account` in Graph
   API Explorer, not the @handle) and **Meta page token** (the token from step 3 — Instagram and
   Messenger share the same Page-based token/endpoint in this codebase).
9. DM the IG business account from a personal account added as a **Tester/Admin** on the Meta App, and
   watch it flow: webhook → signature check → parse → dedupe → `after()` → `aiOrchestrator` → reply
   dispatched via Graph API.

**Not yet done:** none of steps 2–9 have been executed or verified this session — this is guidance
only, ready to execute in the next session.

---

## 9. Outstanding from earlier sessions (unconfirmed, may still be open)

- Real Supabase Auth admin user + first real (non-demo) tenant — was deferred to the user earlier; not
  confirmed done or not.
- Full manual acceptance tests from `docs/07-PHASES.md` Phase 1 checklist (real Meta message e2e,
  two-tenant RLS isolation test, widget allow/deny from a real configured origin) — not yet run.
- `MASTER_OPENAI_KEY` still a placeholder — blocks any real-OpenAI-provider tenant until replaced.

---

## 10. Quick-start for the next session

1. Read this file, then `CLAUDE.md` (root) for the working rules, then skim `docs/09-ORDERS-AND-TOOLS.md`
   if continuing the order-taking feature.
2. Check current model: order-taking Stage A implementation → **Sonnet**. Any new locked-interface
   design work (e.g. Stage D vision, or the client-login routing spec) → **Opus** first.
3. Cross-session memory (outside this repo) also has this context under the `project_crewnest` memory
   entry — this file and that memory should stay roughly in sync; update both if either goes stale.
