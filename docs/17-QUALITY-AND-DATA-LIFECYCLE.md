# 17 — Quality Engineering & Data Lifecycle  (Phase 3)

> **Phase 3, workstream 3 of 4.** The cross-phase engineering backlog doc-07 has carried since Phase 1,
> now in scope: a real **test framework + coverage**, a **CI pipeline**, **observability** (structured
> logging, error tracking, per-tenant cost alerts), and **data lifecycle** (retention + GDPR/Meta
> right-to-erasure). The **hard-delete design is the `[OPUS]` crux** — the DB cascades cleanly but
> Storage and Vault do **not**, and "delete a customer" has no single row to delete. Frozen below.

---

## 1. Testing  — **Stage R**

There is no test framework today (confirmed: no `vitest`/`jest`, `lint` script exists, eslint 9). Prior
Sonnet sessions verified pure logic with disposable scratchpad smoke scripts, then deleted them
(memory). Phase 3 makes that permanent and committed.

**Decision: `vitest`** (Vite-native, TS-first, fast, zero-config with the existing toolchain; not Jest,
which fights ESM/Next 16). Add `vitest` + `@vitest/coverage-v8` devDeps; scripts `test` (`vitest run`)
and `test:watch`.

Three tiers, built in value order:

- **R1 — Unit (pure functions, zero infra).** The highest-value, lowest-cost tier. Cover the security-
  and correctness-critical pure logic that must never silently drift:
  - `services/security/sanitize.ts` — inbound neutralisation; `[HUMAN_HANDOFF]`/signal-token extraction
    and stripping; customer-supplied lookalike neutralisation.
  - `services/meta/signature.ts` — `verifyMetaSignature` accepts a correct HMAC, rejects a wrong/absent
    one (constant-time path exercised).
  - `services/ai/promptBuilder.ts` — **cache-prefix byte-identity**: the static prefix is identical
    across two tenants differing only in dynamic data; retrieved/open-now/continuation content never
    lands inside `cachePrefixLength`. This is the invariant every prior doc leans on — pin it.
  - `services/hours.ts` — `computeOpenNow` (the cases memory smoke-tested: Karachi open/closed, missing
    tz/hours → null, invalid tz → null-not-throw, overnight range, second timezone). Make them real.
  - `services/ai/pricing.ts` — `estimateCostUsd` per model.
  - Doc-15 rate-limit window math; doc-16 metric helpers (any non-SQL computation).
- **R2 — RLS isolation (security-critical, SQL).** Doc-02 + doc-07 both call for a two-tenant isolation
  test. Formalise the rolled-back-transaction probe technique memory already used for `storage.objects`
  into a committed `supabase/tests/rls.sql`: within a `begin … rollback`, `set role authenticated` +
  set `request.jwt.claims`, and assert tenant A's identity sees only A's `chat_sessions`/`orders`/
  `chat_messages`/`usage_logs`/`notifications`, never B's; anon sees nothing; platform_admin sees all;
  the two notification audiences don't cross (doc-14 §2.2). Runnable via the `pg`-script precedent and
  in CI against a Postgres service container seeded with the migrations.
- **R3 — Integration (documented, lighter).** Webhook→reply with a **fake `LlmProvider`** injected
  through `getProvider` (return a scripted reply / tool call) against a transactional test DB. Design
  the seam now (provider factory already indirects — a `CLERKNEST_TEST_PROVIDER` env or a DI hook), ship
  one happy-path + one handoff-path test; expand later. Not a launch blocker, but the seam is part of
  Stage R so it isn't retrofitted.

Coverage is reported, **not gated on a %** initially (a hard threshold on a young suite produces
busywork); the gate is "R1 + R2 green," tightened later.

---

## 2. CI  — **Stage R (cont.)**

**R4 — GitHub Actions** `.github/workflows/ci.yml`, on push + PR to `main`:

1. `npm ci`
2. `node node_modules/typescript/bin/tsc --noEmit` (the existing green gate)
3. `npm run lint`
4. `npm run test` (R1 unit)
5. **RLS tests (R2)** against a `postgres:16` service container: apply `supabase/migrations/*` in order,
   run `supabase/tests/rls.sql`, fail on any assertion.
6. **Secret scan** — `gitleaks` (Action) over the diff; fail on a hit. Complements the doc-02 rule
   "no secret in repo/bundle/log"; catches an accidental `.env`/key commit before it lands.
7. **Migration lint** — a tiny script asserting migrations are monotonically numbered and each uses
   idempotent guards (`if not exists` / `drop … if exists`), matching the house style.

**No secrets in CI.** Tests use fakes and a throwaway Postgres container — never the live Supabase
project or real keys. The build already passes with placeholder env (memory: `.env.local` placeholder
precedent); CI mirrors that.

---

## 3. Observability  — **Stage S**

- **S1 — Structured logging.** Today logging is scattered `console.error('[x] …', {meta})` — already
  redaction-by-convention (metadata only, never bodies/secrets), but ad-hoc. Add `lib/log.ts`:
  `log.error/warn/info(event: string, meta?: Record<string, unknown>)` emitting a single JSON line
  (`{level, event, ...meta, ts}`) that Vercel/Supabase log drains parse. It **strips known-sensitive
  keys** (`text`, `content`, `body`, `key`, `token`, `secret`, `authorization`) defensively even if a
  caller slips. Replace the scattered `console.*` calls across webhook/worker/orchestrator/services.
  Mechanical, high-leverage, no new dep.
- **S2 — Error tracking (env-gated bolt-on).** `@sentry/nextjs`, **no-op unless `SENTRY_DSN` is set**
  (exactly the Resend/email pattern). Capture unhandled exceptions in the pgmq worker, the webhook, and
  `handleInboundMessage` with `tenant_id`/`session_id`/`platform` tags — **never** message bodies or
  keys (Sentry `beforeSend` scrub reusing the S1 sensitive-key list). Optional to enable, but the wiring
  ships so a production incident isn't invisible. **User must provision the Sentry project + DSN** — a
  clean resume point like Resend/gateway.
- **S3 — Per-tenant cost alerts.** A daily cron (§3.1) sums `usage_logs.estimated_cost_usd` per tenant
  for the day; if a tenant crosses `tenants.daily_cost_alert_usd` (new nullable column; null = no
  alert) → emit an **agency** `system_alert` (doc-15's new type) "Tenant X spent $Y today (cap $Z)."
  This is where a runaway pgmq poison-loop, an abuse burst, or a mispriced tenant burning the *master*
  key surfaces before the bill does. Master-key spend (`used_byok=false`) is the alarming kind; weight
  the alert toward it.

### 3.1 The Phase-3 cron

Stages S and T both need a daily scheduled job. **Decision: one Supabase `pg_cron` job** (or a Vercel
Cron hitting an authenticated internal route) invoking `services/maintenance.ts#runDailyMaintenance`,
which fans out to: cost-alert scan (S3), retention sweep (T), and `rate_limit_buckets`/`webhook_events`/
pgmq-archive pruning (§ doc-15). One cron, one entry point, each task best-effort and independently
logged — a failure in one doesn't skip the others. Prefer `pg_cron` (stays inside Supabase, no web
runtime, survives a Vercel deploy) with the maintenance SQL/RPC; the analytics-rollup trip-wire
(doc-16 §5) would hang off the same cron if ever built.

---

## 4. Data lifecycle & right-to-erasure  — **Stage T**  `[OPUS]`

### 4.1 The cascade map (verified against the migrations)

Deleting a **tenant** row cascades cleanly in Postgres: `chat_sessions`, `chat_messages` (via session +
tenant), `orders`, `usage_logs`, `user_tenants`, `notifications`, `demo_leads` are all `tenant_id …
on delete cascade`; `webhook_events.tenant_id` is `on delete set null`. **So the *database* is fine.**
The gaps are the two stores the FK graph doesn't reach:

- **Supabase Storage (`order-media`).** Objects are keyed `<tenant_id>/<session_id>/<uuid>.<ext>`.
  Storage is not FK-linked to `public.*`, so a DB cascade **leaves every customer image/audio/video in
  the bucket forever.** This is the real erasure hole — the most sensitive customer data (a photo, a
  voice note) is the part that *doesn't* get deleted.
- **Vault secrets.** A tenant's LLM key / Meta tokens / payment secrets are `vault.secrets` rows
  referenced by uuid on the tenant row. The cascade drops the *reference*, not the secret. Orphaned
  secrets must be explicitly `vault.delete_secret`'d.

### 4.2 "Delete a customer" has no row  `[OPUS]`

A customer is not an entity — they are `(tenant_id, platform, external_user_id)` spanning one
`chat_sessions` row per channel, their `chat_messages`, and any `orders`. A GDPR right-to-erasure
request targets that triple. **Decision — `services/dataLifecycle.ts#eraseCustomer(tenantId, platform,
externalUserId)`:**

1. Enumerate the customer's sessions; collect their `order-media` storage keys (prefix
   `<tenant_id>/<session_id>/`) and **delete those objects from the bucket** (service-role; the one
   write Storage RLS forbids to everyone else).
2. **Delete the sessions** → `chat_messages` cascade away.
3. On `orders`: **scrub PII in place** (`customer_name/phone/address → null`, mark `pii_erased_at`) but
   **retain the order shell** — the tenant needs the transactional/financial record for their own books
   and tax, and an order with no customer name is no longer personal data. (A tenant may opt for *full*
   order delete; default is scrub-and-retain.) `orders.attachments` media keys are deleted from Storage
   in step 1's sweep.
4. Write an `erasure_events` audit row (§4.4).

Deleting a whole **tenant** (offboarding) = the same, tenant-wide: storage prefix `<tenant_id>/`
removed, Vault secrets deleted, then the tenant row deleted (DB cascade does the rest). Wrap as
`eraseTenant(tenantId)`.

### 4.3 Retention (proactive minimisation)

- `tenants.message_retention_days` (nullable; **null = keep**, the safe default so no one is surprised
  by silent deletion). When set, the daily sweep (§3.1) hard-deletes `chat_messages` older than the
  window for that tenant **and** their orphaned `order-media` objects, keeping `orders` (scrubbing PII
  past the window if configured). A per-tenant knob because a jeweller's records and a café's chit-chat
  have very different retention needs — and some jurisdictions *mandate* a max.
- **Platform-level short retention** on infra tables regardless of tenant setting: `webhook_events`
  older than **30 days** (Meta won't redeliver after days; idempotency only needs a short horizon),
  `rate_limit_buckets` past windows, and pgmq **archive** entries past 30 days. Pure hygiene.
- **Abandoned demo/free tenants**: a `demo_leads`/free-tenant TTL is a policy call flagged for the user,
  not a default (deleting a signup's data automatically is a business decision, not an engineering one).

### 4.4 Erasure audit

`erasure_events (id, tenant_id, subject_platform, subject_external_user_id | null for tenant-wide,
scope text, requested_by uuid, storage_objects_deleted int, completed_at, note)` — service-role write,
agency-read (RLS `to authenticated using is_platform_admin`). Proves to a regulator/Meta that a request
was honoured and bounds what was removed. This is the minimal audit trail; the full **audit-log UI** for
*all* admin actions stays Phase 4 (doc-07) — don't scope-creep it here.

### 4.5 Surfaces

- **Agency**: an "Erase customer data" action on a session/order and an "Offboard tenant" action on the
  client detail page, both confirmation-gated, both calling `dataLifecycle`.
- **Client (tenant-scoped)**: a tenant admin can request erasure of one of *their* customers (they are
  the data controller for their customers; we're the processor). Same function, RLS-scoped to their
  tenant.
- **Data-request inbound**: no public self-service portal in Phase 3 — requests come through the tenant
  or agency, which is the correct controller/processor chain. A public portal is a later addition.

---

## 5. Schema & build order

**Migration `0031_lifecycle.sql`** — `tenants.message_retention_days int`, `tenants.daily_cost_alert_usd
numeric(10,2)`, `orders.pii_erased_at timestamptz`, `erasure_events` table + its RLS + the pg_cron job
registration (or leave cron to the dashboard). Additive.

Ordering across the workstream: **R1 → R2 → R4** (tests + CI first, so everything after is guarded) →
**S1 → S2 → S3** (observability) → **T** (lifecycle, needs the §3.1 cron from S). Each gated by
`tsc --noEmit` + `npm run build`, and from R4 onward by CI itself.

**`[OPUS]` sign-off:** §4 (the cascade map, the Storage+Vault gaps, the customer-as-triple erasure
model, scrub-and-retain orders, retention defaults, the audit table) and §1's R2 RLS-isolation
methodology are **DECIDED & FROZEN**. §3.1 (one pg_cron entry point) is frozen. Sonnet builds R–T with
no further Opus pass; S2 (Sentry) and any TTL-on-abandoned-tenants pause for the user's provisioning/
policy call.

---

## 6. Acceptance criteria

- [ ] `npm run test` runs R1 units green locally and in CI; `supabase/tests/rls.sql` proves two-tenant
      isolation and fails loudly if a policy regresses.
- [ ] CI blocks a PR on a type error, a lint error, a failing test, an RLS breach, or a committed secret.
- [ ] `eraseCustomer` removes the customer's sessions + messages, **deletes their `order-media`
      objects from the bucket** (verified the objects 404 after), scrubs order PII while keeping the
      order shell, and writes an `erasure_events` row.
- [ ] `eraseTenant` additionally deletes the tenant's Vault secrets and leaves **zero** `order-media`
      objects under `<tenant_id>/`.
- [ ] The daily maintenance cron prunes `webhook_events` > 30 d, sweeps `rate_limit_buckets`, and fires
      an agency `system_alert` when a tenant crosses its `daily_cost_alert_usd`.
- [ ] Structured logs are single-line JSON with no message body/secret present (audit a sample);
      Sentry is a no-op without a DSN and captures a thrown worker error (tagged, scrubbed) with one.
- [ ] `tsc --noEmit` + `npm run build` green; deployed.
