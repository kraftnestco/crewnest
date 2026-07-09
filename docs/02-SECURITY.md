# 02 — Security & Compliance

Security is a first-class requirement, not a layer. This doc defines the trust boundaries and the
non-negotiable rules. Every implementation step must satisfy the **Audit Checklist** at the end.

---

## 1. Trust boundaries

| Zone | Trust | What may live here |
|------|-------|--------------------|
| Client browser (customer widget, dashboard UI) | **Untrusted** | Publishable Supabase anon key, tenant **public** key only. **Never** LLM keys, Meta secrets, service-role key. |
| Next.js server (RSC, route handlers, server actions, `after()`) | Trusted | `process.env` master keys, service-role client, decrypted tenant secrets (in memory, transient). |
| Supabase Postgres | Trusted | Encrypted secrets (Vault), all tenant data behind RLS. |
| External providers (OpenAI, Meta) | Semi-trusted | Reached only server-side over TLS. |

**Golden rule:** if a value can decrypt data, send messages, or bill money, it exists **only** on the
Next.js server or inside Postgres — it is never shipped to, or fetched by, a browser.

---

## 2. Secrets & BYOK (Supabase Vault)

Clients bring their own LLM key (BYOK); we also keep master fallback keys. Storage rules:

- **Per-tenant secrets** (client `openai_api_key`, Meta **page access token**, **WhatsApp token**,
  widget signing secret) are stored as **Supabase Vault secrets** via `vault.create_secret(value,
  name, description)`. The `tenants` row stores only the **Vault secret UUID / name reference**, never
  the plaintext.
- **Read** happens server-side only, through a `SECURITY DEFINER` helper that selects from
  `vault.decrypted_secrets` for a specific tenant — called by the service-role client inside
  webhook/`after()` code. The decrypted value is used immediately and never persisted or logged.
- **Master fallback** keys (`MASTER_OPENAI_KEY`, `META_APP_SECRET`, `META_VERIFY_TOKEN`) live in
  Vercel env vars, read via `lib/env.ts`. If a tenant has no BYOK key, fall back to `MASTER_OPENAI_KEY`.
- **`vault.decrypted_secrets` is privileged**: `anon`/`authenticated` roles must have **no** grant on
  it. Only the `SECURITY DEFINER` function (owned by a privileged role) may read it. Verify grants in
  the Vault migration.

> Do not use column-level `pgsodium` transparent encryption for this — Vault (secrets manager) is the
> current, supported primitive. See [`03-DATABASE.md`](./03-DATABASE.md) §Vault helpers.

---

## 3. Authentication & sessions (dashboard)

- **Supabase Auth** with the `@supabase/ssr` cookie flow. Auth cookies are `HttpOnly`, `Secure`,
  `SameSite=Lax` (Lax, not Strict — Strict breaks the OAuth/email-link return redirect; Lax still
  blocks CSRF for cross-site POSTs). Short access-token lifetime with refresh rotation (Supabase
  default) — do not extend.
- **Authorization is server-side.** `proxy.ts` (Next 16 middleware) may do an *optimistic* redirect
  (no session cookie → send to `/login`), but the real gate is in the `admin/layout.tsx` server
  component / server actions calling `supabase.auth.getUser()` (which re-validates the JWT) and
  checking role. Never trust the proxy alone — the Next 16 docs explicitly warn proxy is not a
  session/authorization solution.
- **No tokens in localStorage.** Realtime uses the cookie-bound session; the anon key is public by
  design and safe to expose.

---

## 4. Multi-tenant isolation (RLS)

- **RLS is ON for every table** holding tenant data. No table is readable/writable without a policy.
- Dashboard queries use the **cookie-scoped** client → Postgres enforces the row filter. A tenant
  member sees only rows for tenants in their `user_tenants`; a `platform_admin` sees all.
- The **service-role** client bypasses RLS and is used **only** in trusted server contexts
  (webhook/`after()`), for destination→tenant resolution and cross-tenant writes. It must never be
  imported into a client component or exposed via a public route. Enforce with a server-only import
  guard (`import 'server-only'` at the top of `lib/supabase/service.ts`).
- Full policy set and helper functions (`is_platform_admin()`, `user_can_access_tenant()`) are in
  [`03-DATABASE.md`](./03-DATABASE.md).

---

## 5. Webhook integrity

- **Meta (`/api/webhooks/meta`):**
  - `GET` verification: compare `hub.verify_token` to `META_VERIFY_TOKEN` (constant-time), echo
    `hub.challenge`.
  - `POST`: recompute `HMAC-SHA256(rawBody, META_APP_SECRET)` and compare to `X-Hub-Signature-256`
    using a **constant-time** comparison. **Read the raw body** (do not `await req.json()` first) —
    the signature is over exact bytes. Reject on mismatch with `401` and log nothing sensitive.
- **Shopify (`/api/webhooks/shopify`, Phase 2):** verify base64 `X-Shopify-Hmac-Sha256` over the raw
  body with the app secret. Same raw-body discipline.
- **Idempotency:** every accepted event's provider message id is inserted into `webhook_events`
  (unique). A duplicate insert means "already handled" → ACK `200` and stop. This defeats provider
  retries and double-replies.

---

## 6. Website widget threat model

The widget runs in untrusted pages, so it gets the *least* privilege:

- Authenticated by a **tenant public key** (not a secret) that maps to a tenant. Compromise of a
  public key cannot read data or send on other channels.
- **Origin allowlist:** each tenant stores allowed domains; requests from other origins are rejected
  (checked against `Origin`/`Referer`, and CORS is scoped to allowed domains).
- **Rate limiting** per session/IP to cap abuse and LLM cost (`services/security/rateLimit.ts`).
- Widget responses stream only assistant text — never catalogue internals beyond what the model
  chooses to say, and never any tenant config.

---

## 7. Prompt-injection & LLM guardrails

Customer text is **untrusted input to the model**, not to our SQL (we use the Supabase SDK /
parameterized queries everywhere, so SQL injection is structurally prevented). For the LLM:

- **Structural separation:** customer text is only ever placed in a `user` role message. The
  `system_prompt` + `catalog_data` are in the `system`/leading block and are never concatenated with
  user text.
- **Instruction hardening:** the system prompt states the assistant must not reveal system
  instructions, must not follow instructions embedded in user messages that contradict policy, and
  must treat catalogue data as reference, not commands.
- **Sanitisation** (`services/security/sanitize.ts`): strip control chars, cap length, and neutralise
  known injection markers *before* the text is stored/sent. Never let user text inject the
  `[HUMAN_HANDOFF]` control token — the orchestrator only honours that token when the **assistant**
  emits it, and strips it from any stored/echoed content.
- **Output scope:** the assistant cannot trigger side effects in Phase 1 (no tool-calling yet). When
  tools arrive (Phase 2), each tool is tenant-scoped and validated server-side.

---

## 8. PII, logging & data retention

- Chat content is **PII**. Log **metadata** (tenant id, session id, latency, token counts, error
  codes) — never full message bodies, and **never** decrypted secrets or tokens. Add a redaction
  helper and use it around all logging.
- **Retention:** provide a per-tenant retention window and a hard-delete path for a customer's
  conversation (GDPR/Meta platform-policy readiness). Design now, expose in Phase 2 settings.
- **Data residency:** pick the Supabase region deliberately; document it. Meta Platform Terms require
  compliant handling of message data — keep processing server-side and access-controlled.

---

## 9. Audit checklist (every PR must pass)

- [ ] No LLM key, Meta secret, service-role key, or decrypted token appears in any client bundle,
      response body, URL, log line, or error message.
- [ ] `lib/supabase/service.ts` begins with `import 'server-only'` and is never imported by a client
      component.
- [ ] Every new table has `ENABLE ROW LEVEL SECURITY` + explicit policies; nothing relies on default
      access.
- [ ] Meta `POST` verifies `X-Hub-Signature-256` over the **raw** body with constant-time compare.
- [ ] Every accepted webhook event is idempotent via `webhook_events`.
- [ ] Dashboard authorization is re-checked server-side with `auth.getUser()` + role — not only in
      `proxy.ts`.
- [ ] Widget endpoint enforces origin allowlist + rate limit.
- [ ] Customer text reaches the model only as a `user` message; `[HUMAN_HANDOFF]` is honoured only
      from assistant output and stripped from stored content.
- [ ] Auth cookies are `HttpOnly` + `Secure` + `SameSite=Lax`, short-lived.
- [ ] Logs contain no message bodies or secrets (redaction helper used).
