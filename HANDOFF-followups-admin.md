# HANDOFF — Customer Follow-ups + Admin-Copilot Actions (+ signup/caps audit)

**Author:** Opus (design pass). **Implementer:** Sonnet. **Repo:** `src/crewnest/` (Next 16 + Supabase,
live on Vercel `crewnest-rouge.vercel.app`, GitHub CD — pushing `main` deploys prod).

This doc is self-contained. Read the referenced files before writing code; do **not** rebuild anything
listed under "Already built." Three work items, independent — do them in order, `tsc` + `build` green after
each, commit each separately, **do not push until the user confirms**.

---

## Locked decisions (from the user, this session)

1. **Follow-ups = scheduled *customer* follow-up messages.** The AI employee proactively re-messages a
   customer later ("check on the order tomorrow", "nudge an unanswered quote"). Needs a table + a
   cron worker. NOT owner to-do reminders, NOT copilot UX suggestions.
2. **Admin-copilot actions = mirror the owner's existing 3** — `invite_team_member` / `set_stock` /
   `restock`, for a *named client*, via the same propose→confirm-card→apply spine. **No** account-level
   controls (no `is_active`, no billing). Platform-admin gated.
3. **Global guardrails still hold** (see bottom): off-limits fields have no tool and are hard-rejected;
   never change a tenant's `llm_provider`/`llm_model`; no Stripe/billing this pass.

---

## Already built — DO NOT rebuild

- **Owner (Business) copilot already takes team/inventory actions.** `src/services/ai/copilot/actions.ts`
  defines `copilotActionSchema` (`invite_team_member` | `set_stock` | `restock`) + `describeCopilotAction`;
  `src/app/dashboard/business/copilot-actions.ts` `applyCopilotActionAction` re-auths and dispatches to
  `inviteMember` / `setItemStockAction` / `restockItemAction`. Item 2 below **reuses this schema and these
  functions** on the admin side — it does not invent new ones.
- **Signup + free-plan caps are shipped** (item 3 is an *audit*, not a build). `(auth)/signup/` +
  `provision-actions.ts`; caps in `src/services/aiOrchestrator.ts` (`FREE_PLAN_DAILY_SESSION_CAP`,
  `DEFAULT_FREE_MONTHLY_CAP_USD`, `free_monthly_cap_usd`); migration `0025`.
- **Inventory actions are already tenant-parameterized + platform-admin-aware.**
  `setItemStockAction(tenantId, …)` / `restockItemAction(tenantId, …)` in
  `src/app/dashboard/inventory/inventory-actions.ts` take an explicit `tenantId` and their
  `assertTenantAdmin(tenantId)` **already allows `ctx.isPlatformAdmin`**. So the admin copilot can call
  them verbatim once it resolves a client name → id. `inviteMember(tenantId, …)` in
  `src/services/teamMembers.ts` likewise takes an explicit `tenantId`.
- **Outbound delivery + proactive-send primitive exist.** `sendText({tenant, platform, to, text})` in
  `src/services/meta/send.ts`. `continueSession(sessionId, note, authoredBy)` in
  `src/services/aiOrchestrator.ts:557` persists a note then runs a full LLM turn that **composes and
  dispatches** a reply on the customer's channel. `messages.persist({…, authoredBy})` writes chat rows via
  the service client.

---

## ITEM 1 — Customer follow-up messages

### Model
A follow-up is a **future instruction to the AI**, tied to a `chat_session`, that fires at `send_after`.
At fire time the worker calls `continueSession(sessionId, instruction, 'ai')`, which runs a normal turn so
the AI composes a *context-aware* message from the live conversation + profile and dispatches it on the
same channel — no canned strings, no duplicate send/persist logic.

The AI employee schedules follow-ups **during a customer conversation** via a new customer-agent tool
(same registry as `createOrder` etc.). (Owner-copilot scheduling is an optional stretch — skip for MVP.)

### Deliverability = HYBRID (auto-send when possible, owner-alert when not) — READ THIS
Meta's **24h window**: a business-initiated free-form message is rejected unless it's within 24h of the
customer's last inbound message (outside that, Meta requires a pre-approved *template* — see `sendTemplate`
in `meta/send.ts` lines 64+). MVP does **not** build template approval. So the worker branches, per due
follow-up, on whether we can actually deliver:

- **In-window (deliverable) → AUTO-SEND.** For a Meta-channel session whose *last inbound customer message*
  is **< 24h old**, run `continueSession(...)` so the AI composes + sends the follow-up. Covers the common
  "check back this evening / tomorrow morning" cases. → `status='sent'`.
- **Out-of-window, or no push channel → OWNER-ALERT (this is the user's "tenant alert" idea).** If the last
  inbound is **≥ 24h old** (send would be rejected), or the session is the **web widget** (`platform==='web'`
  has no push channel — see `aiOrchestrator.ts` ~line 513), **do not attempt an LLM turn**. Instead
  `notify` the owner via the existing notifications system (`type: 'follow_up_due'`, message names the
  customer + the follow-up reason + why it couldn't auto-send) so they follow up from their own inbox.
  → `status='alerted'`. No LLM spend.
- **Send failed anyway** (Meta throws even though we thought we were in-window, e.g. token/window edge) →
  fall through to the same owner-alert branch (`status='alerted'`, `last_error=<slice>`), never a silent drop.

To classify in/out of window, query the latest inbound (`role='user'`/customer) `chat_messages` row for the
session and compare `created_at` to now. Do this for all Meta channels (whatsapp/messenger/instagram all
have a 24h window). The `schedule_follow_up` tool still **accepts** any delay in range; whether it later
auto-sends or owner-alerts is decided at fire time by this rule — so the AI never has to reason about windows.

**Scheduling on web sessions:** allow it (it becomes an owner-alert), but the tool must **not** promise the
*customer* a proactive message on web — the AI should phrase it as "I'll flag this for the team to follow up"
rather than "I'll message you." (Alternatively refuse on web entirely; owner-alert is the more useful default.)

### Schema — new migration `supabase/migrations/0035_follow_ups.sql` (additive, idempotent)
```sql
create table if not exists public.scheduled_follow_ups (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  session_id    uuid not null references public.chat_sessions(id) on delete cascade,
  instruction   text not null,                    -- what the AI should follow up about
  send_after    timestamptz not null,
  status        text not null default 'pending',  -- pending | sent | failed | cancelled | alerted
  attempts      int  not null default 0,
  last_error    text,
  created_by    text not null default 'ai',        -- 'ai' | 'owner' (future)
  created_at    timestamptz not null default now(),
  sent_at       timestamptz
);
alter table public.scheduled_follow_ups drop constraint if exists scheduled_follow_ups_status_check;
alter table public.scheduled_follow_ups add constraint scheduled_follow_ups_status_check
  -- 'sent' = AI auto-delivered; 'alerted' = out-of-window/no-channel, owner notified to send manually.
  check (status in ('pending','sent','failed','cancelled','alerted'));
create index if not exists scheduled_follow_ups_due_idx
  on public.scheduled_follow_ups (send_after) where status = 'pending';
create index if not exists scheduled_follow_ups_session_idx
  on public.scheduled_follow_ups (session_id);
alter table public.scheduled_follow_ups enable row level security;
-- Agency + owning-tenant read; writes are service-role only (worker + tools use service client),
-- mirroring usage_logs / erasure_events. Add a select policy modeled on an existing per-tenant
-- select policy (grep an existing migration for `for select to authenticated using (...tenant...)`).

-- Widen the notifications type check to allow the owner-alert branch (see the hybrid-delivery
-- section). Additive + idempotent, exactly like 0031 did for 'system_alert' — 0029/others can
-- redefine the same constraint again later with no conflict. Keep the FULL existing type list.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'new_order','handoff','alert_signal','channel_request','payment_proof',
    'upgrade_request','review','order_updated','media_review','system_alert','follow_up_due'
  ));
```
(If a client component renders notification types with a per-type icon/label, add a `follow_up_due`
case there too — grep for `notifications_type_check`'s type strings in `src/` to find the render site.)
Regenerate `src/types/database.ts` if the repo has a generated-types step; otherwise hand-add the row type
consistent with the existing file. Update `docs/` type notes only if other tables do.

### Customer-agent tool — `src/services/tools/schedule_follow_up.ts` + register in `registry.ts`
Follow the exact shape of an existing writing tool (`createOrder.ts` is the closest template — it writes via
the service client and returns a short confirmation string). The tool:
- Args (zod): `{ delay: string /* e.g. "in 1 day", "tomorrow 10am" — parse to a timestamp server-side, clamp
  to [now+15min, now+14days] */, about: string /* the instruction */ }`. Prefer an explicit
  `send_after_iso` if you'd rather have the model emit an ISO time — pick one and validate hard.
- Guards: cap **max 1 pending** follow-up per session (if one exists, update it instead of stacking); cap
  total pending per tenant (e.g. 200) to bound the worker. (Web sessions are allowed — they become an
  owner-alert at fire time per the hybrid rule — but see the phrasing note above.)
- Writes a `scheduled_follow_ups` row (`status='pending'`, `created_by='ai'`) via the service client.
- Gate it behind the same per-tenant tool-enable mechanism the other tools use
  (`getEnabledTools` in `registry.ts`) — decide whether it's on by default; recommend **on** for Meta
  channels. Add a matching mention in the system-prompt tool guidance if `promptBuilder.ts` enumerates tools.

### Cancel-on-reply guardrail
In `handleInboundMessage` (aiOrchestrator, the inbound entry ~line 80), when a customer sends a new message,
**cancel** (`status='cancelled'`) any `pending` follow-up for that `session_id` before running the turn —
don't nag someone who already came back. One `update` via service client; keep it cheap and failure-tolerant
(log, don't throw).

### The worker — `src/services/followUps.ts` + `src/app/api/cron/follow-ups/route.ts`
- `runDueFollowUps()` in a new `followUps.ts` (plain TS, service client, no `next/*` — mirror
  `services/maintenance.ts`): select `pending` rows with `send_after <= now()` (bounded LIMIT, e.g. 50),
  **claim** each by incrementing `attempts` (and/or a short-lived guard) before acting, to avoid a double
  fire if two sweeps overlap. For each: load session + tenant, then:
  1. **Free-plan cap first.** If `plan='free'` and already `plan_status='cap_reached'` (or would exceed
     `free_monthly_cap_usd`/`DEFAULT_FREE_MONTHLY_CAP_USD`) → `status='failed'`, `last_error='cap_reached'`,
     **no spend**. Reuse aiOrchestrator's existing cap check; don't duplicate the threshold.
  2. **Hybrid deliverability branch** (see the deliverability section):
     - In-window Meta channel → `continueSession(session.id, instruction, 'ai')` → on success `status='sent'`,
       `sent_at=now()`; on thrown send error → owner-alert branch below.
     - Out-of-window, or `platform==='web'` → **owner-alert**: `notify` the owner
       (`type:'follow_up_due'`) with the customer + reason + why-not-auto, `status='alerted'` (no LLM turn).
  Return a summary `{claimed, sent, alerted, failed}`.
- The route mirrors `api/cron/maintenance/route.ts` **exactly** for auth: `runtime='nodejs'`,
  `maxDuration=300`, reject unless `Authorization === "Bearer ${env.CRON_SECRET}"`, fail closed 403 if
  `CRON_SECRET` unset, Sentry-capture on throw. (Same route regardless of trigger — see below.)

### Trigger = Supabase pg_cron + pg_net (NOT Vercel cron — project is on the Vercel free/Hobby plan)
Vercel Hobby only allows daily crons, so the schedule lives in **Supabase** instead: a `pg_cron` job calls
the authenticated Vercel route via `pg_net` every 15 min. Free-tier, self-contained, and unaffected by repo
activity. **Do NOT add anything to `vercel.json`.** This SQL is run **manually** in the Supabase SQL editor
(same manual-migration convention as everything else) — put it in a clearly-commented block, either as a new
`supabase/migrations/0036_follow_ups_cron.sql` or appended to `0035` with a "run after deploy + Vault secret"
header. Prereqs: the app is deployed with `CRON_SECRET` set in Vercel env, and the *same value* is stored in
Supabase Vault.
```sql
-- Run in Supabase AFTER: app deployed with CRON_SECRET in Vercel env, and the same secret in Vault:
--   select vault.create_secret('<the CRON_SECRET value>', 'follow_ups_cron_secret');
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'follow-ups-sweep',
  '*/15 * * * *',
  $$
  select net.http_get(
    url     := 'https://<PROD_DOMAIN>/api/cron/follow-ups',   -- e.g. crewnest-rouge.vercel.app or the custom domain
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'follow_ups_cron_secret')
    )
  );
  $$
);
```
Verify exact `net.http_get` / `cron.schedule` signatures against current Supabase docs before finalizing
(schema-qualification of `net`/`cron`/`vault` can vary). ⚠ If Vercel **Deployment Protection** is on for
production, it will block this automated GET — production on Hobby is public by default, but confirm, and if
protected, add a bypass. To unschedule during testing: `select cron.unschedule('follow-ups-sweep');`.
The user must run this SQL — hand it to them with the real domain + secret filled in; it is NOT auto-applied.

### Item 1 verification
- `tsc --noEmit` + `npm run build` green.
- Unit-trace: schedule via tool → row `pending`; `runDueFollowUps()` on a due **in-window** Meta row →
  `continueSession` called, row → `sent`. Not-yet-due row is skipped.
- **Hybrid:** a due row whose last inbound is ≥24h old → **no** LLM turn, owner gets a `follow_up_due`
  notification, row → `alerted`. A due **web** session → same owner-alert path.
- Guardrails: a customer reply cancels the pending follow-up; a `cap_reached` free tenant → `failed`,
  `last_error='cap_reached'`, no LLM spend; only 1 pending follow-up per session.
- Trigger: hitting `/api/cron/follow-ups` without the bearer → 403; the pg_cron SQL schedules a job that
  reaches the route (test with `select cron.schedule(... '* * * * *' ...)` once, then reset to `*/15`).
- No secret leakage; worker uses the service client only.

---

## ITEM 2 — Admin Copilot actions (mirror the owner's 3)

Today `adminCopilotTurnAction` (`src/app/admin/copilot-actions.ts`) returns `{reply, error}` only — plain
text, zero write tools (`adminCopilotTools.ts` has two READ-only lookups). The admin copilot UI
(`src/app/admin/copilot/page.tsx` + its client panel) renders text bubbles only. We add a **staged action +
confirm card + apply action**, reusing the owner-side schema and privileged functions.

### Reuse, don't reinvent
- **Schema:** import `copilotActionSchema` / `CopilotAction` / `describeCopilotAction` from
  `src/services/ai/copilot/actions.ts` as-is. The three ops are identical.
- **Apply functions:** `inviteMember(tenantId, …)`, `setItemStockAction(tenantId, …)`,
  `restockItemAction(tenantId, …)` — all already platform-admin-aware. The admin path just supplies a
  resolved `tenantId`.

### Tenant resolution (the one genuinely new bit)
Admin actions target a **named client**, not the caller's own tenant. Add a resolver: given a business name,
`ilike` `tenants.business_name` (reuse the `ilikePattern` + `TENANT_LIMIT` approach already in
`adminCopilotTools.ts`). If 0 matches → error string; if >1 → return the candidates and make the model ask the
operator to disambiguate (do **not** guess). The staged action must carry the **resolved `tenantId`** (and
the business name for the card), so apply-time acts on an unambiguous target.

### Wiring
1. **Tool(s):** add write tool defs to `adminCopilotTools.ts` — `invite_team_member` / `set_stock` /
   `restock`, each taking a `business_name` plus the owner-side args. But like the copilot spine, these tools
   are **side-effect-free at model time**: they only *stage* the action (resolve the tenant, build a
   `CopilotAction` + tenantId, return a one-line "proposed: …" using `describeCopilotAction`). Nothing writes
   during the turn. Keep the two read-only lookups as-is.
2. **Turn action:** extend `adminCopilotTurnAction` to also return a staged
   `{ action: CopilotAction, tenantId, businessName } | null` (mirror how the business copilot surfaces a
   staged action/patch out of its turn). Keep the platform-admin gate + master-key resolution unchanged.
3. **Apply action:** new `applyAdminCopilotActionAction(tenantId, action)` in `admin/copilot-actions.ts`:
   `getCallerContext` → **require `ctx.isPlatformAdmin`** (hard 403 otherwise) → re-validate with
   `validateCopilotAction` (`.strict()` allowlist rejects anything else) → dispatch to the same three
   functions with the passed `tenantId`. This is the ONLY writer. Return `ApplyActionResult`.
4. **UI:** in the admin copilot client panel, render a **ProposedActionCard** (reuse `describeCopilotAction`
   for the human line; show the target business name) with **Apply** / **Dismiss**, exactly like the business
   copilot's action card. Apply calls `applyAdminCopilotActionAction` then refreshes.
5. **System prompt:** update `buildSystemPrompt` in `admin/copilot-actions.ts` — it currently says the copilot
   "CANNOT change any setting, message any customer, pause any account, invite anyone, update inventory."
   Narrow that to: it **can** propose inviting a teammate to a client, and set/restock a client's inventory
   (owner confirms each), but still **cannot** pause/reactivate accounts, change plans/models/secrets, or
   message customers — for those, point to the client page.

### Security notes (bigger blast radius than owner side — hold the line)
- Blast radius is *any* tenant via platform-admin privilege, so the propose→confirm→apply split and the
  `.strict()` allowlist are load-bearing — keep the LLM strictly non-writing; only
  `applyAdminCopilotActionAction` writes, and only after re-checking `isPlatformAdmin` + re-validating.
- **No** new action types. Absolutely no `is_active`, `plan`, `plan_status`, `llm_*`, `*_secret_id`,
  billing, or customer-messaging action — none exists on the owner side and none is added here.
- Keep using the RLS-scoped server client for reads (per `adminCopilotTools.ts` rationale); the three apply
  functions manage their own writes.

### Item 2 verification
- `tsc` + `build` green.
- "invite ali@x.com to Sabiha Jewellers as agent" → card shows the invite for the resolved tenant → Apply →
  `inviteMember` runs against Sabiha's `tenantId`; a non-admin session is refused by the apply action.
- Ambiguous/zero name match asks to disambiguate / reports not found — never guesses a tenant.
- "pause Grand Cottages" / "switch them to GPT-4" → copilot explains it can't and points to the client page;
  no such action is ever stageable; a hand-crafted apply call with an off-allowlist type is rejected.

---

## ITEM 3 — Signup + free-plan caps AUDIT (trace + test script, not a rebuild)

Goal: prove the shipped path is correct end-to-end and find gaps. Deliver a short written findings list
(bugs/gaps ranked), not code — unless a clear bug is found, then fix it in a separate commit.

### Trace these paths and answer the questions
1. **Signup → provision** (`(auth)/signup/*`, `provision-actions.ts` `provisionTenantAction`):
   - Is `provisionTenantAction` safe against a signed-in user who **already owns a tenant** (should refuse —
     `ctx.memberships.length > 0`)? Against being called twice (double-submit / race)? Any way to pass a
     `planId` outside `['free','starter','pro']`?
   - Does a brand-new free tenant land with the right `plan`/`plan_status` (free → `plan_status` null per the
     shipped code)? Is the caller linked as `tenant_admin`?
   - Referral attribution (`cn_ref` cookie → `referred_by`) — does a missing/garbage cookie degrade cleanly?
2. **Daily session cap** (`aiOrchestrator.ts`, `FREE_PLAN_DAILY_SESSION_CAP = 5`):
   - Is the cap counted per **tenant per UTC day**, at session creation? Off-by-one (is the 5th allowed and 6th
     blocked, or 5th blocked)? Does the customer-facing `cap_reached` message actually reach the customer, and
     does the agency get notified? Does an existing (already-open) session still get served once the cap is
     hit, or are ongoing conversations wrongly blocked?
3. **Monthly cost cap** (`DEFAULT_FREE_MONTHLY_CAP_USD`, `tenants.free_monthly_cap_usd`, non-BYOK turns):
   - When `spentUsd >= cap`, does it flip `plan_status='cap_reached'`, notify **agency + tenant**, and return
     the cap message — exactly once, not every subsequent turn (notification spam)? Do **BYOK** tenants
     correctly bypass the master-key cap? Is "spent this month" actually scoped to the current month?
   - **Does the new follow-up worker (item 1) honor this same cap?** (It must — cross-check after item 1.)
4. **Recovery:** once `plan_status='cap_reached'`, what un-sticks a tenant (month rollover? manual admin?)?
   Is there any path back, or does a capped free tenant stay dead until someone intervenes? Note it even if
   "manual only" is acceptable — the user should know.

### Manual test script (hand to the user; do NOT create real prod tenants without asking)
Prefer a local/preview env. 1) Sign up a fresh email → confirm a free tenant provisions + caller is admin.
2) Open 5 new conversations as different customers → 6th hits the daily cap message; agency notified.
3) Force the monthly cap (temporarily lower `free_monthly_cap_usd` for the test tenant in the DB) → next
   non-BYOK turn returns the monthly message, flips `cap_reached`, notifies both, and does **not** re-notify on
   the following turn.

---

## Global constraints (all items)

- **Off-limits fields have no tool and are hard-rejected** everywhere: `llm_provider`, `llm_model`, all
  `*_secret_id`, `plan`, `plan_status`, `free_monthly_cap_usd`, `daily_cost_alert_usd`, `is_active`,
  `message_retention_days`, channel IDs, `slug`, billing. Never add a tool for these; keep them out of any
  prompt snapshot.
- **Never** change a tenant's `llm_provider`/`llm_model` — no code path here should.
- **No Stripe / billing** this pass (deferred).
- Migrations are plain idempotent SQL in `supabase/migrations/`, applied **manually** in the Supabase SQL
  editor (manual-migration drift is a known gotcha) — so after writing `0035` (table + notifications type)
  and `0036` (the pg_cron/pg_net trigger), **give the user the exact SQL to paste**, with the pg_cron block's
  `<PROD_DOMAIN>` and Vault-secret steps filled in. Don't assume any of it auto-applies.
- `'use server'` files export **async functions only** (a non-async export there is a runtime crash).
- Run the **full `npm run build`**, not just `tsc` — server/client boundary bugs only surface in the build.
- **Commit each item separately; do NOT push** (prod deploy) until the user says so.

## Critical files
- **Item 1:** `supabase/migrations/0035_follow_ups.sql` (new: table + notifications-type widening) ·
  `supabase/migrations/0036_follow_ups_cron.sql` (new: the pg_cron/pg_net block, run manually) ·
  `src/services/tools/schedule_follow_up.ts` (new) + `registry.ts` · `src/services/followUps.ts` (new) ·
  `src/app/api/cron/follow-ups/route.ts` (new) · `src/services/aiOrchestrator.ts` (`continueSession` reuse +
  cancel-on-reply hook) · `src/services/notifications.ts` (owner-alert `follow_up_due`) · **NOT** `vercel.json`.
  Reference: `services/maintenance.ts`, `api/cron/maintenance/route.ts`, `meta/send.ts`, `messages.ts`,
  `tools/createOrder.ts`.
- **Item 2:** `src/app/admin/copilot-actions.ts` (extend turn + new apply action + prompt) ·
  `src/services/ai/adminCopilot/adminCopilotTools.ts` (add staging write-tools + tenant resolver) ·
  `src/app/admin/copilot/page.tsx` + its client panel (ProposedActionCard) · reuse:
  `src/services/ai/copilot/actions.ts`, `inventory-actions.ts`, `teamMembers.ts`,
  `dashboard/business/copilot-actions.ts` (pattern for staging+apply+card).
- **Item 3:** `(auth)/signup/*`, `provision-actions.ts`, `aiOrchestrator.ts`, `lib/constants.ts`,
  `notifications.ts` — read-only trace + findings.
