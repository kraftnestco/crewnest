# 14 — Command Center, Live Notifications & Premium UX

> **Commercial roadmap Track 1.** Turns CrewNest from "an inbox you have to go look at" into a system
> that *tells you* when something needs you, aggregates everything actionable into one glanceable place
> for both the agency and each client, and wraps the whole authenticated experience in a premium,
> self-explanatory UI. This is the nervous system the later commercial tracks (ROI analytics, lifecycle
> automation, billing) all emit into.

Design frozen in an Opus session (2026-07-20). Build is **Sonnet**, following §9 stages in order.
Additive only — every change is backward-compatible; a tenant with nothing pending sees empty states,
never errors. Nothing here touches a locked interface from docs 01–13.

---

## 1. Goals & non-goals

**Goals**
1. **Live notifications** — a realtime bell in *both* shells (agency `/admin`, client `/dashboard`) that
   lights up the moment something happens, no page refresh, no polling.
2. **1-click monitoring** — a "Needs attention" command center that rolls every open action item
   (pending orders, payment proofs to verify, active handoffs, alert-flagged chats, channel requests)
   into one place, each row linking straight to the screen that resolves it.
3. **A real client home** — `/dashboard` stops redirecting to the inbox and becomes a genuine landing
   page: the client's own needs-attention queue plus a first slice of value stats.
4. **Premium, intuitive UX** — a shared page-header + top-bar system, standardized empty/loading states,
   status legends, tooltips on ambiguous controls, and a proper **Account/Profile** surface (today there
   is none — sign-out is an orphan sidebar button).

**Non-goals (explicitly deferred)**
- Full ROI/analytics dashboards → **Track 2** (this doc ships only a light stat teaser on the client home).
- Off-hours away-messages, handoff SLA escalation, proactive/outbound messaging → **Track 3** (they will
  *emit into* the notification service built here).
- Billing/plans/quota → **Track 4** (decided: subscription + usage/quota; billing events will also emit
  notifications — e.g. dunning — via this same service).
- A full visual re-skin. We standardize and polish the *existing* shadcn/Tailwind-v4 system; we do not
  redesign tokens or swap the component library.

---

## 2. Data model

### 2.1 `notifications` table (migration `0023_notifications.sql`)

```sql
-- 0023_notifications.sql — Track 1 (docs/14). Live notification feed for both shells.

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  -- Audience is MUTUALLY EXCLUSIVE by design (see §2.2): a row is for the agency
  -- OR for a tenant's own members, never "both" — shared events emit two rows with
  -- audience-appropriate copy + link.
  scope        text not null check (scope in ('agency','tenant')),
  tenant_id    uuid references public.tenants(id) on delete cascade,  -- always set (even agency rows are about a tenant)
  type         text not null check (type in (
                 'new_order','handoff','alert_signal','channel_request','payment_proof'
               )),
  title        text not null,
  body         text,                      -- short, NON-SECRET; never raw customer text (§8)
  entity_type  text,                      -- 'order' | 'session' | 'tenant' | null
  entity_id    uuid,
  link         text not null,             -- audience-correct in-app path, e.g. /admin/orders?status=pending
  is_read      boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists notifications_scope_read_idx
  on public.notifications (scope, is_read, created_at desc);
create index if not exists notifications_tenant_idx
  on public.notifications (tenant_id, is_read, created_at desc);

alter table public.notifications enable row level security;
```

`type` is **text + CHECK**, not a Postgres enum — matches the `alert_signal` (`0017`) and
`payment_methods` (`0013`) "app-validated string" precedent, so adding a type later (Track 2/3/4) is a
one-line CHECK change, no enum migration.

### 2.2 RLS — mutually-exclusive audiences

```sql
-- Agency rows: platform admins only.
create policy notifications_select_agency on public.notifications
  for select to authenticated
  using (scope = 'agency' and public.is_platform_admin());

-- Tenant rows: DIRECT members of that tenant only. Deliberately NOT via
-- public.user_can_access_tenant(), because that helper returns true for a
-- platform_admin too — which would leak every client's tenant feed into the
-- agency bell. Membership is checked directly so the two audiences stay disjoint.
create policy notifications_select_tenant on public.notifications
  for select to authenticated
  using (
    scope = 'tenant'
    and exists (
      select 1 from public.user_tenants ut
      where ut.user_id = auth.uid() and ut.tenant_id = notifications.tenant_id
    )
  );
```

**No INSERT/UPDATE/DELETE policy.** Writes are **service-role only** (like `usage_logs`,
`webhook_events`, `orders`): the system emits notifications; users never write them directly. Mark-read
is a server action that derives the caller's audience server-side and writes via the service-role client
(§4.3) — so we need no authenticated write policy and there's no way for a client to forge or edit a row.

> **Build note:** confirm the exact helper name/signature (`public.is_platform_admin()`,
> `public.user_can_access_tenant(uuid)`) against `0005_functions.sql`/`0006_rls.sql` before applying —
> reuse whatever those files define; do not invent new helpers.

### 2.3 `profiles.notification_prefs` (same migration)

```sql
alter table public.profiles
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;
```

Shape (app-validated, all optional): `{ "email_enabled": boolean, "muted_types": string[] }`. Absent
keys = defaults (`email_enabled` defaults false until Resend is configured, §9 Stage O7; nothing muted).
Drives the Account page toggles (§7.3) and gates email fan-out (§3.4).

### 2.4 Type + domain wiring
- Hand-edit `src/types/database.ts` (Row/Insert/Update for `notifications`; add `notification_prefs` to
  `profiles`) — the manual-edit precedent (we do not regenerate types; see CLAUDE.md build note).
- Add `Notification` to `src/types/domain.ts` and a `mapNotification()` if a camelCase domain shape is
  used by the UI (mirror `mapTenant()` in `services/tenants.ts`).

---

## 3. Notification service & emit points

### 3.1 `services/notifications.ts` — the one emitter

**Critical constraint:** this service is called from `aiOrchestrator.ts`, which is **trigger-agnostic —
imports no `next/*`**. So `notifications.ts` must mirror `services/sessions.ts` exactly: it imports the
**service-role** Supabase client and **no `next/*`**, keeping it callable from the webhook `after()`, the
widget route, *and* a future pgmq consumer. (It may transitively be `server-only` like every other leaf
service; that only bars client-bundle imports, which never happens here.)

```ts
export type NotificationType =
  | 'new_order' | 'handoff' | 'alert_signal' | 'channel_request' | 'payment_proof';

export interface NotifyInput {
  scope: 'agency' | 'tenant';
  tenantId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  entityType?: 'order' | 'session' | 'tenant' | null;
  entityId?: string | null;
  link: string;
}

/** Insert one notification row (service-role). Best-effort: never throws into the
 *  caller's hot path — logs and swallows, like the owner-notify path in createOrder. */
export async function notify(input: NotifyInput): Promise<void>;

/** Convenience: emit the agency + tenant rows for an event both audiences care about,
 *  each with its own copy + audience-correct link. */
export async function notifyBoth(args: {
  tenantId: string; type: NotificationType;
  agency: { title: string; body?: string; link: string };
  tenant: { title: string; body?: string; link: string };
  entityType?: NotifyInput['entityType']; entityId?: string | null;
}): Promise<void>;
```

`notify` is **best-effort** — wrapped in try/catch, logs `[notifications] emit failed` and returns; a
failed notification must never break order creation or a customer reply (same discipline as the
best-effort `sendTemplate` owner-notify in `orders/actions.ts`).

### 3.2 Emit points (all already server-side; purely additive)

| Event | Where to call from | Rows | Link (agency / tenant) |
|-------|--------------------|------|------------------------|
| New / pending order | `services/tools/createOrder.ts` executor, after the order persists | both | `/admin/orders?status=pending` / `/dashboard/orders` |
| Handoff triggered | `aiOrchestrator.ts` — at the two `sessions.setHandoff(session.id, true)` sites (assistant-requested ~L195 and round-cap fallback ~L178) | both | `/admin/chat?session={id}` / `/dashboard/chat?session={id}` |
| Alert signal set/changed | `aiOrchestrator.ts` — the `setAlertSignal` site (~L190), **only when the value changed** (§3.3) | both | `/admin/chat?session={id}` / `/dashboard/chat?session={id}` |
| Channel setup request | `dashboard/actions.ts` `requestPlatformSetupAction`, after the update succeeds | agency only | `/admin/clients/{tenantId}` |
| Payment proof awaiting verify | the proof-routing path that calls `setPaymentStatus('awaiting_verification')` (`services/mediaIntake.ts` / `orders.ts`) | both | `/admin/orders` / `/dashboard/orders` |

**Do not** emit on every inbound message during an already-active handoff (orchestrator L84) — that would
be one ping per customer message. Notify on the *transition* into handoff only.

### 3.3 Avoiding alert-signal spam (dedupe at the source)
`aiOrchestrator` L190 currently sets the signal every qualifying turn. Change `sessions.setAlertSignal`
to return whether the value actually changed (compare to the row's current `alert_signal` before writing,
or use an `update … where alert_signal is distinct from $1 returning`), and emit the notification **only
when it changed**. This keeps the same "sticky, set-once" philosophy the signal already has (memory:
alert_signal is never auto-cleared) and prevents a long angry conversation from firing N identical alerts.

### 3.4 Email fan-out (optional, env-gated — Stage O7)
Inside `notify`, after the DB insert, best-effort email **iff** `env.RESEND_API_KEY` is set AND the
recipient's `notification_prefs.email_enabled` is true AND `type ∉ muted_types`:
- **agency** recipients = `profiles where is_platform_admin = true`; **tenant** recipients = that tenant's
  `user_tenants` members' emails.
- Send via a tiny `services/email.ts` REST wrapper (no new npm dep required — POST to Resend's API).
- If `RESEND_API_KEY` is absent, this whole branch is a no-op. **The in-app bell is the core deliverable
  and ships without any external dependency;** email is a bolt-on the user enables later.

---

## 4. Realtime bell

### 4.1 Component: `components/notification-bell.tsx` (client)
- Renders a bell icon with an unread-count badge in the top bar of both shells.
- **Initial load + mark-read go through server actions** (§4.3) — never a browser `.from()` read, per the
  hard-won rule (memory / docs correction): `realtime.setAuth()` authorizes only the WebSocket, not
  PostgREST, so any client-side `.from()` on an RLS table returns empty.
- **Live inserts** arrive via a `postgres_changes` subscription on `public.notifications` using the same
  `setAuth`'d browser client the Live Inbox already uses (`inbox.tsx` pattern). RLS scopes delivery
  automatically — the agency socket only receives agency rows, a client socket only their tenant rows.
- Click a notification → `router.push(link)` and mark it read. A "Mark all read" action clears the badge.
- Accepts the initial list + unread count as props from the server-rendered top bar (no loading flash).

### 4.2 Mounting
Add a slim **top bar** to each shell layout (`app/admin/layout.tsx`, `app/dashboard/layout.tsx`) hosting:
left = page context (breadcrumb/title slot); right = `<NotificationBell/>` + `<AccountMenu/>` (§7). The
top bar is a Server Component that fetches the initial notifications (server action / server client) and
passes them to the client bell. See §7.1 for the shared shell.

### 4.3 Server actions: `app/(notifications)/actions.ts` (or `lib/notifications/actions.ts`)
```ts
'use server';
listNotificationsAction(limit?: number): Promise<Notification[]>   // RLS server client; scoped automatically
getUnreadCountAction(): Promise<number>
markNotificationReadAction(id: string): Promise<void>              // service-role write; audience derived from getCallerContext
markAllNotificationsReadAction(): Promise<void>                    // filters by caller's audience (agency: scope=agency; tenant: scope=tenant AND active tenant)
```
Mutations resolve the caller via `getCallerContext()` / `is_platform_admin`, build the audience filter
**server-side**, and write via the service-role client. A client can therefore only ever mark *their own*
audience's rows, and can't touch any other column. (Same "server decides authority" stance as the order
actions.) **Remember the `'use server'` rule:** this module exports async functions only — put any shared
constant/type in a sibling non-`'use server'` file (memory: the 3× runtime-crash bug).

---

## 5. Command center — "Needs attention"

### 5.1 Agency Overview (`app/admin/page.tsx`)
Add a **Needs attention** section above the existing stat cards. Each item = a live count + a link to the
filtered view that resolves it. All are cheap `head:true` count queries through the RLS server client
(agency sees all tenants):

| Card | Query | Link |
|------|-------|------|
| Orders to approve | `orders` where `status='pending'` | `/admin/orders?status=pending` |
| Payments to verify | `orders` where `payment_status='awaiting_verification'` | `/admin/orders` |
| Live handoffs | `chat_sessions` where `is_human_handoff=true` | `/admin/chat` |
| Flagged chats | `chat_sessions` where `alert_signal is not null` | `/admin/chat` |
| Channel requests | `tenants` where `array_length(requested_platforms,1) > 0` | `/admin/clients` |

A card with count 0 renders muted/collapsed; when everything is 0, show a single "All clear ✓" state.
Confirm `orders-view.tsx` already reads `?status=` (it does — cursor-paginated status filter); if it
lacks a payment filter, the payments card links to plain `/admin/orders` for now (Track 2 can add the
filter). No schema change anywhere in §5.

### 5.2 Reusable aggregate
Factor the counts into `services/overview.ts` (`getAgencyNeedsAttention()` /
`getTenantNeedsAttention(tenantId)`) so the agency Overview and the client home (§6) share one
implementation and can't drift. Both run through the RLS server client — the tenant variant is
auto-scoped by RLS, the agency variant sees all.

---

## 6. Client home (`app/dashboard/page.tsx`)

Stop the redirect-to-`/dashboard/chat`. Render a real home:
1. **Needs attention** — `getTenantNeedsAttention(activeTenantId)`: my pending orders, my payments to
   verify, my live handoffs, my flagged chats. Same card component as §5, links into the `/dashboard/*`
   equivalents.
2. **Value teaser** (seeds Track 2, kept deliberately light): conversations handled (last 30d, count on
   `chat_messages`/`chat_sessions`), active conversations, orders this month. 3–4 numbers, no charts yet.
3. **Empty/getting-started** state when the tenant has no activity — a friendly "your AI assistant is
   live on {connected channels}; here's where your customer chats and orders will show up," linking to My
   Business to finish setup. This is the first thing a newly-onboarded client sees, so it must read as a
   confident product home, not a blank page.

Respect the existing role split: `tenant_agent` (staff) sees inbox/orders needs-attention; the value
teaser + business nudge are fine for both roles (they're read-only counts).

---

## 7. Premium UX & account surface

The point is **intuitive + self-explanatory + premium + easy to navigate** without a risky re-skin.
Concretely:

### 7.1 Shared shell primitives (new components)
- `components/page-header.tsx` — `<PageHeader title description? actions?/>` with an optional breadcrumb.
  Replaces every ad-hoc `<h1 className="font-heading …">` + `<p className="text-muted-foreground">` block
  (Overview, Settings, Orders, Business, etc.) so headers are pixel-consistent and every screen states
  what it's for in one sentence.
- `components/app-topbar.tsx` — the slim top bar (§4.2): breadcrumb/title on the left, `NotificationBell`
  + `AccountMenu` on the right. Mounted once per shell layout.
- `components/account-menu.tsx` — avatar/initials button → dropdown (name + email, "Account", "Sign
  out"). Moves sign-out out of the sidebar footer into a conventional, discoverable place.
- `components/empty-state.tsx` — `<EmptyState icon title hint cta?/>`. Standardizes the many bare "No X
  yet." strings into something that guides the next action.
- `components/ui/skeleton.tsx` (add if absent) + `loading.tsx` for the heavier routes (inbox, orders,
  overview) so navigation feels instant instead of blank-then-pop.
- `components/status-legend.tsx` — a small colored-dot legend for order-status and for the four
  `alert_signal` values, reused in Orders and the Inbox so the color coding is never a mystery. Pair with
  `title=`/tooltip on the ambiguous action buttons (Take over, Approve, Verify proof, Reject).

### 7.2 Navigation & feel polish (no new components, just consistency)
- Keep the existing active-state nav (already highlights via `usePathname`); extend the same treatment to
  the new top bar breadcrumb.
- Consistent surface language everywhere: `rounded-xl`, `ring-1 ring-foreground/10` cards, one spacing
  rhythm (`p-6` page padding, `space-y-6` sections) — audit the existing pages to this baseline.
- Section descriptions on every list/table (one muted sentence: "what this is / what to do here").

### 7.3 Account / Profile pages
Two thin routes sharing one `AccountForm`:
- `app/admin/account/page.tsx` and `app/dashboard/account/page.tsx` (each in its own shell so the nav/top
  bar stays correct), both rendering `<AccountForm profile={…} scope=…/>`.
- Fields: **full name** (editable → `profiles.full_name`), **email** (read-only v1 — avoid the Supabase
  email-change reauth flow this pass), **change password** (`supabase.auth.updateUser({ password })`),
  and **notification preferences** — an "email me" master toggle + per-type mute checkboxes writing
  `profiles.notification_prefs` (§2.3). The email toggle is visible but annotated "requires email
  delivery — contact us to enable" until Stage O7 is live.
- Server actions in a `'use server'` module (async-only export rule).

---

## 8. Security

- **Writes are service-role only**; reads are RLS-scoped; audiences are disjoint (§2.2). A client can
  neither forge a notification nor see another tenant's feed nor the agency feed.
- **No secrets, no raw customer text in `title`/`body`.** A notification carries `type`, `business_name`,
  an entity id, and a signal label — all non-secret. Never interpolate the customer's message, a token, a
  key, or a decrypted secret into a notification (docs/02 §9). The link is an in-app path, not a signed URL.
- Realtime delivery is RLS-enforced on the `setAuth`'d socket — the same trust boundary as the Live Inbox.
- Email fan-out (Stage O7) sends only the same non-secret title/body + an app link; recipient lists are
  resolved server-side from `profiles`/`user_tenants`, never from client input.

---

## 9. Build order (Sonnet) — Stages O1 → O7

Backward-compatible at every stage; typecheck + build must stay green (there is no test framework —
verify with `tsc --noEmit` + `npm run build`, and a disposable smoke script for `computeChanged`-style
logic if useful, then delete it — memory precedent).

- **O1 — Schema.** `0023_notifications.sql` (table + RLS + `profiles.notification_prefs`) applied to the
  LIVE Supabase project via the standard no-Docker `pg`-script-inside-`src/crewnest` precedent (script
  created → run → deleted). Hand-edit `types/database.ts`; add `Notification` to `types/domain.ts`.
- **O2 — Service + actions.** `services/notifications.ts` (`notify`, `notifyBoth`); the four server
  actions (§4.3) with the async-only-export split. No emit points wired yet.
- **O3 — Emit points.** Wire all five events (§3.2); add the "changed" semantics to
  `sessions.setAlertSignal` (§3.3). Verify each call site is server-side and best-effort.
- **O4 — Bell + top bar.** `notification-bell.tsx` + `app-topbar.tsx` + `account-menu.tsx`; mount the top
  bar in both layouts; realtime subscription reuses the inbox's `setAuth` client.
- **O5 — Command center.** `services/overview.ts` aggregate; Needs-attention section on `/admin`.
- **O6 — Client home + UX kit.** Real `/dashboard` home (§6); `page-header`, `empty-state`, `skeleton`,
  `status-legend`; Account pages (§7.3); apply `PageHeader`/empty states across existing screens.
- **O7 — Email (optional, env-gated).** `services/email.ts` Resend REST wrapper + the fan-out branch in
  `notify` (§3.4); no-op unless `RESEND_API_KEY` is set. **Needs the user to provision Resend first** —
  treat as a clean resume point, exactly like Stage L for payments.

O1–O6 have **no external dependency** and deliver the whole in-app experience. O7 is the only gated step.

---

## 10. Acceptance criteria
- [ ] A new pending order, a handoff, a first-time alert signal, a channel request, and a payment proof
      each produce a notification that appears in the correct bell **live, without refresh**.
- [ ] The agency bell shows only agency rows; a client bell shows only that client's tenant rows; two
      clients never see each other's; a client never sees the agency feed. (RLS two-audience test.)
- [ ] Alert-signal notifications fire once per *change*, not once per turn.
- [ ] `/admin` shows a Needs-attention section whose counts match reality and whose links land on the
      filtered view; "All clear" when everything is 0.
- [ ] `/dashboard` is a real home (no redirect): tenant-scoped needs-attention + stat teaser + a
      confident empty state for a fresh tenant.
- [ ] Every authenticated screen uses the shared `PageHeader`, has a top bar with the bell + account
      menu, and an Account page exists in both shells with working name/password/notification-prefs.
- [ ] No secret or raw customer text ever appears in a notification row (audit).
- [ ] `tsc --noEmit` + `npm run build` green; deployed; bell verified live on Vercel.
