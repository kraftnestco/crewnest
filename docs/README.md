# CrewNest — Architecture & Build Docs

> **CrewNest** is a multi-tenant SaaS that gives businesses "AI employees": an AI that answers
> customer messages across WhatsApp, Facebook/Instagram DMs, and website chat, grounded in each
> client's own catalogue and brand persona — with a human-takeover inbox and an agency dashboard
> to onboard, monitor, and control every client from one place.

This `docs/` folder is the **single source of truth** for how CrewNest is designed. It was written
in an Opus planning session so that implementation sessions (Sonnet) can build without re-deciding
architecture. **Read the docs in order before writing code.**

---

## Who does what

- **Planning (Opus):** all architecture, the database schema + RLS, the AI pipeline design, the
  security model, and the phase roadmap are decided here and frozen into these docs + the SQL
  migrations + the TypeScript interface stubs.
- **Implementation (Sonnet):** follow [`08-IMPLEMENTATION-GUIDE.md`](./08-IMPLEMENTATION-GUIDE.md)
  top to bottom. It lists every file to create, in order, with its responsibility and done-criteria.
  When a step is tagged **`[OPUS]`**, pause and ask the user to switch to Opus for that step.

## Document map

| Doc | What it covers |
|-----|----------------|
| [`01-ARCHITECTURE.md`](./01-ARCHITECTURE.md) | System components, runtime choices, request flows, directory layout, deployment topology |
| [`02-SECURITY.md`](./02-SECURITY.md) | Threat model, zero-trust rules, secret handling, signature verification, injection guardrails, audit checklist |
| [`03-DATABASE.md`](./03-DATABASE.md) | Full schema, every table/column/enum/index, and the roles + RLS model |
| [`05-AI-PIPELINE.md`](./05-AI-PIPELINE.md) | `aiOrchestrator` step-by-step, prompt-cache assembly, `LLMProvider` abstraction, memory, handoff protocol |
| [`06-INTEGRATIONS.md`](./06-INTEGRATIONS.md) | Meta (WhatsApp/FB/IG) inbound + outbound, website widget, token model, Shopify & voice (later) |
| [`07-PHASES.md`](./07-PHASES.md) | Phase 1→4 scope, acceptance criteria, and where Opus is needed |
| [`08-IMPLEMENTATION-GUIDE.md`](./08-IMPLEMENTATION-GUIDE.md) | File-by-file build order for Sonnet + the Next.js 16 gotcha cheat-sheet |

SQL migrations live in [`../supabase/migrations/`](../supabase/migrations/). TypeScript interface
stubs live under [`../src/`](../src/) with `TODO(sonnet)` markers where bodies must be filled in.

---

## Tech stack (pinned)

| Layer | Choice | Version / notes |
|-------|--------|-----------------|
| Framework | Next.js **App Router** | **16.2.10** — ⚠️ Middleware is now `proxy.ts`; see the Next-16 cheat-sheet in the implementation guide |
| Language | TypeScript | 5.x, `strict` |
| UI | React + Tailwind CSS | React 19.2, **Tailwind v4** (CSS-first config, no `tailwind.config.js`) |
| Components | shadcn/ui | Tailwind-v4 compatible init |
| DB / Auth / Realtime | Supabase (Postgres) | Postgres 15+, RLS, Supabase Auth (SSR cookies), Realtime `postgres_changes`, **Vault** for secrets |
| Async work | Next.js `after()` (Phase 1) → **pgmq** (upgrade) | `after()` runs post-response; pgmq for durable retries at scale |
| LLM | Provider abstraction, **OpenAI `gpt-4o-mini` default** | Per-tenant provider override; BYOK keys stored in Vault |
| Hosting | Vercel + Supabase | Webhook routes on Node runtime (see architecture) |

## Locked decisions (do not re-litigate)

1. **Supabase, not Firebase/Mongo.** RLS is the multi-tenant isolation primitive; Realtime powers the
   live inbox; Vault stores BYOK secrets; `pgvector` is available later for large catalogues (so **no
   Pinecone** — one datastore).
2. **Zero secrets on the client.** All LLM/Meta calls are server-side only. (See [`02-SECURITY.md`](./02-SECURITY.md).)
3. **Fast-ACK webhooks.** Webhooks verify → dedupe → **return 200 immediately**, then process the AI
   turn in `after()`. Never block the ACK on an LLM call.
4. **Agency super-admin + per-tenant scope.** RLS supports a platform-admin role (you) that sees all
   tenants, plus (later) client logins scoped to their own tenant.
5. **Meta onboarding: manual token paste now, embedded-signup OAuth later** — token storage is shaped
   so OAuth drops in with no schema change.
6. **Catalogue grounding: stuff-and-cache first.** Small catalogues go into the cached system prompt;
   `pgvector` retrieval is added only when a catalogue outgrows the token budget.

## Phases at a glance

- **Phase 1 — Text omnichannel MVP** (launch target): WhatsApp + FB + IG + website chat answering,
  catalogue-grounded, human handoff, agency dashboard with live inbox. Manual Meta token onboarding.
- **Phase 2 — Automation & self-serve:** Shopify catalogue auto-sync, workflow/automation actions
  (tool-calling), client-facing logins, billing (Stripe), embedded Meta signup.
- **Phase 3 — Voice & scale:** SIP/voice AI, pgmq durable queue, `pgvector` RAG for large catalogues,
  analytics.
- **Phase 4 — Platform:** template marketplace, multi-agent workflows, deeper integrations.

See [`07-PHASES.md`](./07-PHASES.md) for detailed scope and acceptance criteria.
