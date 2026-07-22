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
  catalogue, and inbox (RLS already supports this — no policy rewrite). The client-dashboard **feature
  surface is already designed/built** by doc 09 (orders, inbox, kill switch) + doc 10 (intake wizard,
  custom-order config, approval queue); the remaining Phase-2 work is auth + the routing change to admit
  `tenant_admin` past the `is_platform_admin` gate — see [`10-…`](./10-CUSTOM-ORDERS-MEDIA-AND-INTAKE.md) §9.
- **Custom orders & media intake:** image → voice → video customer media, catalogue matching, per-tenant
  approval toggle, and the client intake wizard — designed in
  [`10-CUSTOM-ORDERS-MEDIA-AND-INTAKE.md`](./10-CUSTOM-ORDERS-MEDIA-AND-INTAKE.md). `[OPUS]` gates: storage
  RLS grants, the multimodal `LlmMessage` union, and the video frame pipeline (doc 10 §11).
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

## Phase 3 — Harden, Prove & Complete the Ecosystem

> **Rescoped 2026-07-22 (user):** Voice AI/SIP moved **out to Phase 4** — no real voice-interpretation
> capability exists yet, and the priority is perfecting the text/media/order ecosystem already shipped.
> `pgvector` RAG already **shipped** (doc-12 Stage N, folded in early). What remains of the old "Voice &
> Scale" is reliability + analytics, now expanded with the cross-phase backlog and a hardening pass.
> Fully designed across **docs 15–18**; all `[OPUS]` gates below are **CLEARED**.

**Scope** (four workstreams — see the docs for stages, schema, acceptance criteria):
- **Reliability & durable delivery** — [`15-RELIABILITY-AND-DURABILITY.md`](./15-RELIABILITY-AND-DURABILITY.md):
  enable **pgmq** (`0008`), move Meta webhook processing from `after()` to a queue + worker
  (at-least-once, poison-safe), Postgres-backed rate limiting, Meta 24 h-window handling. Orchestrator
  unchanged (trigger-agnostic).
- **Analytics & the proof layer** — [`16-ANALYTICS-AND-PROOF.md`](./16-ANALYTICS-AND-PROOF.md): volumes,
  deflection rate, handoff rate (by cause), cost per tenant (BYOK vs master), CSAT (via existing order
  reviews) + sentiment health; agency + client dashboards. Derived from existing tables, no new capture.
- **Quality engineering & data lifecycle** — [`17-QUALITY-AND-DATA-LIFECYCLE.md`](./17-QUALITY-AND-DATA-LIFECYCLE.md):
  `vitest` unit + RLS-isolation tests, GitHub Actions CI (typecheck/lint/test/secret-scan/migration-lint),
  structured logging + env-gated Sentry + per-tenant cost alerts, retention + GDPR/Meta right-to-erasure
  (incl. the Storage + Vault gaps the DB cascade misses).
- **Hardening & complementary features** — [`18-HARDENING-AND-TEAM.md`](./18-HARDENING-AND-TEAM.md): the
  live-code audit findings + fixes, rolling conversation memory (long-session coherence), a real
  free-plan monthly cost ceiling, and **tenant self-service team management**.

**`[OPUS]` checkpoints — all CLEARED (designed 2026-07-22):**
- ✅ **Queue delivery guarantees** (at-least-once + two-source idempotency + poison handling) — doc-15 §3–4.
- ✅ **Analytics metric definitions + CSAT strategy** — doc-16 §2, §4.
- ✅ **Right-to-erasure / data-lifecycle** (cascade map, Storage/Vault gaps, customer-as-triple) — doc-17 §4.
- ✅ **Rolling-summary prompt seam, free-plan ceiling, team-management guardrails** — doc-18 §2, §3, §5.
- ✅ **RAG retrieval design** — already cleared + shipped in doc-12 (N1).

Sonnet builds Stages **P → Q → R → S → T → U → V** against docs 15–18 with no further Opus pass.

---

## Phase 4 — Voice & Platform

**Scope:**
- **Voice AI** (moved here from Phase 3): SIP-trunk transcripts → orchestrator → TTS; `platform='voice'`
  (the `sip_trunk_id` / `webhooks/voice` 501 stub is the seam). Net-new capability — needs its own Opus
  design pass (STT/TTS provider, realtime turn-taking, latency budget, handoff interplay).
- Template/persona marketplace, multi-agent workflows (a "crew" of specialised agents), deeper CRM/
  helpdesk integrations, white-label, granular team roles/permissions, audit-log UI.

---

## Cross-phase engineering backlog
**Now pulled into Phase 3** — see [`17-QUALITY-AND-DATA-LIFECYCLE.md`](./17-QUALITY-AND-DATA-LIFECYCLE.md):
- Tests: unit (promptBuilder ordering, sanitize, signature verify), integration (webhook→reply with a
  mocked provider), RLS tests (two-tenant isolation). e2e (dashboard login → onboarding → inbox) remains
  a later add.
- CI: typecheck, lint, migration check, secret-scan. No secrets in repo.
- Observability: structured, redacted logs; error tracking; per-tenant cost alerts.
- Data lifecycle: retention windows + hard-delete path (GDPR/Meta policy).
