# 07 — Phase Roadmap

Build order optimised for a **fast market launch of the text answering engine**, then expand. Each
phase lists scope, acceptance criteria (definition of done), and **`[OPUS]`** checkpoints — moments
where you should switch the model to Opus because the reasoning is high-stakes or novel.

---

## Phase 1 — Text Omnichannel MVP  ⭐ launch target

**Goal:** a client's customers message on WhatsApp / FB / IG / website and get accurate, on-brand,
catalogue-grounded answers; staff watch and take over from one dashboard.

**Scope**
- Supabase schema + RLS + Vault (migrations `0001`–`0007`).
- Supabase clients (server RLS, service-role, browser) + env validation.
- `LLMProvider` (OpenAI) + `promptBuilder` (cache ordering) + `aiOrchestrator`.
- Meta webhook (GET verify + POST signature + dedupe + `after()` processing) + Graph outbound.
- Website widget endpoint + embeddable `widget.js`.
- Dashboard: Supabase Auth login, server-gated `/admin`, sidebar (Overview, Clients, Live Inbox,
  Settings).
- Clients page + **onboarding wizard** (business, Meta ids, system prompt, catalogue JSON, masked
  BYOK/token fields → Vault).
- Live Inbox: 3-pane, realtime via `postgres_changes`, red handoff rows, **Take Over** toggle, manual
  send.
- Voice + Shopify routes exist as stubs.

**Acceptance criteria**
- [ ] Sending a WhatsApp/Messenger/IG test message yields an AI reply grounded in that tenant's
      catalogue, in the tenant's persona/language.
- [ ] Webhook ACKs < 1s; AI reply sent from `after()`; duplicate deliveries never double-reply.
- [ ] `X-Hub-Signature-256` rejection verified with a bad signature.
- [ ] Two tenants cannot see each other's data (RLS test with two logins / two destinations).
- [ ] No secret appears in any client bundle, response, URL, or log (audit checklist passes).
- [ ] Take Over mutes the AI for that session; manual replies deliver on the real channel.
- [ ] Widget answers on a test page from an allowed origin; blocked from a non-allowed origin.

**`[OPUS]` checkpoints in Phase 1**
- Applying/adjusting **RLS policies & Vault helper grants** (security-critical; get privileges exactly
  right).
- Finalising the **`promptBuilder` cache ordering** and the `GUARDRAIL_RULES` system text.
- The **Meta payload normaliser** (Messenger vs IG vs WhatsApp shapes) if the shapes fight you.
Everything else in Phase 1 is mechanical for Sonnet given the stubs + guide.

---

## Phase 2 — Automation & Self-Serve

**Goal:** turn "answering" into "doing", and let clients self-onboard and pay.

**Scope**
- **Tool-calling / workflows:** the `tool` message role goes live; tenant-scoped tools (check order,
  book appointment, create lead, fetch live inventory). A workflow registry per tenant.
- **Shopify auto-sync:** webhook updates `catalog_data`; initial catalogue import.
- **Client-facing logins:** activate `user_tenants` roles; tenant_admins manage their own prompt,
  catalogue, and inbox (RLS already supports this — no policy rewrite).
- **Embedded Meta signup:** OAuth connect flow writing Vault secrets.
- **Billing:** Stripe subscriptions + usage metering from `usage_logs`; plan limits/quotas.
- **Conversation summarisation** for long sessions.

**Acceptance criteria**
- [ ] A tool call executes server-side, tenant-scoped, and its result is grounded into the reply.
- [ ] A client logs in and sees only their tenant; edits their prompt/catalogue; watches their inbox.
- [ ] Stripe subscription gates active seats/quota; usage rolls up per tenant per period.
- [ ] Embedded signup connects a Page/WA number without manual token paste.

**`[OPUS]` checkpoints**
- **Tool-calling security model** (authorising and sandboxing per-tenant tool execution).
- **Billing/quota logic** tying `usage_logs` → plan enforcement (edge cases, proration).
- **Summarisation strategy** (what to keep, cost/quality trade-off).

---

## Phase 3 — Voice & Scale

**Scope**
- **Voice AI:** SIP-trunk transcripts → orchestrator → TTS; `platform='voice'`.
- **Durable queue:** enable **pgmq** (`0008`), move webhook processing from `after()` to a queue +
  consumer for retries/backpressure. Orchestrator unchanged (trigger-agnostic).
- **`pgvector` RAG:** embed large catalogues, retrieve top-k; `promptBuilder` `mode:'retrieve'`.
- **Analytics:** volumes, deflection rate, handoff rate, cost per tenant, CSAT.

**`[OPUS]` checkpoints**
- **RAG retrieval design** (chunking, embedding model, hybrid search, re-ranking).
- **Queue delivery guarantees** (at-least-once + idempotency interplay; poison-message handling).

---

## Phase 4 — Platform

**Scope:** template/persona marketplace, multi-agent workflows (a "crew" of specialised agents),
deeper CRM/helpdesk integrations, white-label, team roles/permissions, audit log UI.

---

## Cross-phase engineering backlog
- Tests: unit (promptBuilder ordering, sanitize, signature verify), integration (webhook→reply with a
  mocked provider), RLS tests (two-tenant isolation), e2e (dashboard login → onboarding → inbox).
- CI: typecheck, lint, migration check, secret-scan. No secrets in repo.
- Observability: structured, redacted logs; error tracking; per-tenant cost alerts.
- Data lifecycle: retention windows + hard-delete path (GDPR/Meta policy).
