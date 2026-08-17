@AGENTS.md

# ClerkNest — Project Guide

Multi-tenant SaaS giving businesses "AI employees": an AI that answers customer messages across
WhatsApp, Facebook/Instagram DMs, and website chat — grounded in each client's catalogue and brand
persona — with human handoff and an agency dashboard. Next.js 16 + Supabase.

## Read the specs first (source of truth)
Everything is designed in [`docs/`](./docs/). Read in order before writing code:
`docs/README.md` → `01-ARCHITECTURE` → `02-SECURITY` → `03-DATABASE` → `05-AI-PIPELINE` →
`06-INTEGRATIONS` → `07-PHASES` → **`08-IMPLEMENTATION-GUIDE`** (build order + Next-16 cheat-sheet).
SQL is in `supabase/migrations/`. TS stubs with `TODO(sonnet)` markers are under `src/`.

## How we work here
- Architecture was frozen in an **Opus** session. Implementation is done in **Sonnet**.
- **Do not redesign the locked interfaces/stubs** — fill the `TODO(sonnet)` bodies.
- Steps tagged **`[OPUS]`** in `docs/08` (RLS/Vault review, promptBuilder + guardrails, Meta payload
  normaliser, and Phase 2/3 items) → pause and ask the user to switch to Opus.

## Locked decisions (don't re-litigate)
1. Supabase (RLS isolation, Realtime inbox, Vault secrets, pgvector later — **no Pinecone**).
2. **Zero secrets on the client** — all LLM/Meta calls are server-side only.
3. **Fast-ACK webhooks**: verify → dedupe → 200, then process the AI turn in `after()` (Phase 1).
   pgmq is the Phase-3 durability upgrade; keep `aiOrchestrator` trigger-agnostic.
4. Agency **platform_admin** sees all tenants; client logins (Phase 2) are tenant-scoped — RLS already
   supports both.
5. LLM **provider abstraction**, OpenAI `gpt-4o-mini` default, per-tenant override.
6. Meta onboarding: **manual token paste now**, embedded-signup OAuth later (same Vault columns).

## ⚠️ Next.js 16 — this is NOT the Next.js in your training data
- **Middleware is renamed `proxy.ts`** (root/`src`), exports `proxy`. Ours is optimistic-auth only —
  real auth is server-side in `app/admin/layout.tsx`.
- `cookies()` / `headers()` are **async** (`await`). `params`/`searchParams` are **Promises**.
- Route handlers: `route.ts`, uncached by default; read the **raw body** (`await req.text()`) before
  parsing when verifying signatures.
- **`after()`** (`next/server`) runs post-response — used for the AI turn; set `maxDuration`.
- Tailwind **v4** (CSS-first, no `tailwind.config.js`). Turbopack is default.
- When unsure, read `node_modules/next/dist/docs/01-app/...` or context7 `/vercel/next.js`. Don't guess.

## Security non-negotiables (full list: docs/02 §9)
- Never ship/return/log an LLM key, Meta secret, service-role key, or decrypted token.
- `lib/supabase/service.ts` is `server-only`; never import it into a client component.
- Every table has RLS + explicit policies. Meta POST verifies `X-Hub-Signature-256` over the raw body.
- Every webhook event is idempotent via `webhook_events`.

## Build & verify
```
npm run dev            # local dev (Turbopack)
npm run build          # production build
node node_modules/typescript/bin/tsc --noEmit   # typecheck (keep it green)
```
After applying migrations: `npx supabase gen types typescript --project-id <id> > src/types/database.ts`
and re-add the `<Database>` generic in the three `lib/supabase/*` client factories.

## Commit convention
End commit messages with:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
