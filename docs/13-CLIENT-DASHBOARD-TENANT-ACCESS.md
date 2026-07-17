# 13 — Client Dashboard: Tenant-Scoped Access (security design)

**Status:** `[OPUS]` security pass complete — design frozen for Sonnet to implement.
**Scope of this doc:** the Phase-2 "client-facing logins" from
[`07-PHASES.md`](./07-PHASES.md) Phase 2 and [`10-…`](./10-CUSTOM-ORDERS-MEDIA-AND-INTAKE.md) §9 —
let a tenant's own staff (e.g. a restaurant owner) sign in and see a **scoped** view of *their own*
Live Inbox and Orders, reusing the agency-side logic/components without ever seeing another tenant's
data. **This doc is design only.** It does not implement the UI; a Sonnet session builds from §11.

> Locked decision #4 (CLAUDE.md) is unchanged: *"Agency platform_admin sees all tenants; client
> logins are tenant-scoped — RLS already supports both."* This doc refines the **routing mechanism**
> and closes the **service-role guard** and **`tenants_write`** gaps that would otherwise turn "RLS
> supports it" into a real leak. It does not re-litigate #4.

---

## 1. What the read-only investigation actually found (corrections included)

I verified every claim in the task brief against source. Two of them are materially different from the
brief's framing — the corrections change the recommendation, so read this section first.

**Confirmed as stated:**
- `0005_functions.sql` — `is_platform_admin()` and `user_can_access_tenant(uuid)` are both
  `security definer`, `search_path=''`. `user_can_access_tenant(t)` = `is_platform_admin() OR EXISTS
  (user_tenants row for auth.uid()+t)`. So a signed-in user with a `user_tenants` row already has
  legitimate, DB-enforced access to that tenant's rows through any **RLS-respecting** client.
- `0006_rls.sql` — `chat_sessions`, `chat_messages` (select+insert), `usage_logs` (select) are scoped
  by `user_can_access_tenant(tenant_id)`. `chat_sessions_write` and `chat_messages_insert` also use it,
  so a tenant member can **toggle handoff** and **manual-send** under existing RLS with no change.
- `orders` (`0009`) — RLS `orders_select using user_can_access_tenant(tenant_id)`; **no** authenticated
  write policy (writes are service-role only, by design). Confirmed.
- `tenants_write` (`0006`) — `is_platform_admin()` **only**. A tenant member can `SELECT` their tenant
  row but cannot `UPDATE` it. Confirmed, and it is an **active** gap for self-serve editing (see §3.3).
- `user_tenants` PK is `(user_id, tenant_id)` (`0003`) → **one user can belong to many tenants.** The
  routing design must handle multi-membership (§4.3).
- `member_role` enum (`0002`) = `('platform_admin','tenant_admin','tenant_agent')`.
- Highest existing migration is **`0017_alert_signal.sql`** → the next number is **`0018`**.

**Corrected — the brief's central risk claim is not what the code does:**
- The brief says `getMessagesAction` / `manualSendAction` / `takeOverAction` / the orders actions
  "call a service-role Supabase client which bypasses RLS." **They do not.** Every one of them takes the
  **RLS-authenticated** server client (`createSupabaseServerClient()`, `src/lib/supabase/server.ts`) for
  the read that gates access, and the code comments say so explicitly ("RLS-scoped read also acts as the
  access check"). The **service-role** client (`createServiceClient()`, `src/lib/supabase/service.ts`,
  `import 'server-only'`) is confined to `services/orders.ts`, `services/tenants.ts`, and
  `services/meta/media.ts`, and is only ever reached **after** an RLS read has already proven access,
  using tenant-ids taken **from the RLS-read row** (never from a client param).
- **Consequence:** the existing inbox/orders server actions are **already tenant-safe to reuse** for a
  tenant member — the "read-as-access-check" pattern makes them so, because RLS returns rows for a
  member only within their own tenant(s). The real risk is therefore **not** the existing actions; it is
  **new** tenant-facing code that (a) uses `createServiceClient()` in an authenticated request path, or
  (b) trusts a URL/param `tenant_id` for scoping, or (c) reuses an **agency page** whose information
  architecture enumerates other tenants. §2 and §6 target exactly those.

---

## 2. The guard pattern (recommended, two layers)

**Layer 1 — RLS server client is the isolation boundary (already in place; keep it).**
In every tenant-facing read, write-gate, and list, use `createSupabaseServerClient()`. **Never** use
`createServiceClient()` in a request served to a tenant user, and **never** call the RLS-bypassing
service helpers (`services/tenants.getById`, `services/orders.getById/listForSession/getOrdersPage*`
that hit the service client, `services/meta/media.download`) with an id that came from the client
without first proving ownership via an RLS read. RLS + the existing read-as-access-check pattern is what
keeps tenants isolated.

**Layer 2 — an authoritative server-derived caller context + explicit assert (new, defense-in-depth).**
Add one shared helper that resolves *who is calling* from the session cookie only — never from a request
body/param/URL:

```ts
// src/lib/auth/context.ts   (NEW, server-only)
import 'server-only';
import { cache } from 'react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

export type MemberRole = Database['public']['Enums']['member_role'];
export interface Membership { tenantId: string; role: MemberRole }
export interface CallerContext {
  userId: string;
  email: string | null;
  fullName: string | null;
  isPlatformAdmin: boolean;
  memberships: Membership[];       // [] for a pure platform admin or an unassigned user
}

/** Request-scoped (React cache): resolves the caller from the auth cookie only. */
export const getCallerContext = cache(async (): Promise<CallerContext | null> => {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();   // getUser, not getSession — verified
  if (!user) return null;

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from('profiles').select('email, full_name, is_platform_admin').eq('id', user.id).single(),
    // user_tenants_select RLS already returns only the caller's own rows.
    supabase.from('user_tenants').select('tenant_id, role').eq('user_id', user.id),
  ]);

  return {
    userId: user.id,
    email: profile?.email ?? user.email ?? null,
    fullName: profile?.full_name ?? null,
    isPlatformAdmin: profile?.is_platform_admin ?? false,
    memberships: (memberships ?? []).map((m) => ({ tenantId: m.tenant_id, role: m.role })),
  };
});

/** Server-side scoping authority. NEVER derive the active tenant from a client-supplied value. */
export function assertTenantAccess(ctx: CallerContext, tenantId: string): void {
  const ok = ctx.isPlatformAdmin || ctx.memberships.some((m) => m.tenantId === tenantId);
  if (!ok) throw new Error('Forbidden: tenant not accessible.');
}
```

Then, in any action that **accepts a `tenant_id`/entity id as a parameter and performs a service-role
write**, add the assert as belt-and-suspenders against a future refactor that swaps an RLS read for a
service read. The existing inbox/orders actions do not strictly need it (their RLS read already gates),
but the *tenant-facing* config write does (§3.3, §7).

**Rule of thumb for the implementer:** the active `tenantId` for any tenant-scoped screen is **always**
`ctx.memberships[…]`, chosen/validated server-side (§4.3) — it is never read from `params`,
`searchParams`, form fields, or a cookie without validating it against `ctx.memberships` on that same
request.

---

## 3. Per-action inventory: what a tenant dashboard calls, and the exact guard

All actions below already exist and are **reused as-is**. Column "Guard today" states why it is already
tenant-safe; "Add" states the (small) hardening, if any.

### 3.1 Live Inbox — `src/app/admin/chat/actions.ts`

| Action | Reads via | Guard today (why tenant-safe) | Add |
|---|---|---|---|
| `getMessagesAction(sessionId)` | RLS server client | `chat_messages_select` = `user_can_access_tenant(tenant_id)`; a member passing another tenant's `sessionId` gets **zero rows**. | none |
| `getMessageMediaUrlAction(messageId, path)` | RLS server client, then service-role `media.getSignedUrl` | RLS read of the message gates it; then it verifies `path ∈ that row's attachments` before signing. Member can only sign media of a message they can RLS-read. | none |
| `takeOverAction(sessionId, value)` | RLS server client `.update` | `chat_sessions_write` = `user_can_access_tenant(tenant_id)`; update of a non-accessible session affects 0 rows. | none |
| `manualSendAction(sessionId, text)` | RLS read → RLS insert → service `tenants.getById(session.tenant_id)` for the Meta send | RLS read gates; `chat_messages_insert with check user_can_access_tenant`; `tenants.getById` is called only with the **RLS-read** `session.tenant_id`, never a client value. | none |

### 3.2 Orders — `src/app/admin/orders/actions.ts`

| Action | Reads via | Guard today (why tenant-safe) | Add |
|---|---|---|---|
| `getOrdersPageAction({status,before})` | RLS server client `.select('*')` | No explicit tenant filter — relies on `orders_select` RLS. A member sees only their tenant's orders. Cursor pagination unaffected. | none |
| `getOrderMediaUrlAction(orderId, path)` | RLS read → service `media.getSignedUrl` | RLS read of the order gates it; path-ownership verified before signing. | none |
| `approveOrderAction(orderId)` | RLS read of the order → `orderService.approve` (service write) → `tenants.getById(order.tenant_id)` for notifications | RLS read returns nothing for a non-member → "Order not found" thrown **before** any service write; all downstream ids are RLS-read values. | none |
| `rejectOrderAction`, `markPaidAction`, `markRefundedAction`, `rejectPaymentProofAction` | same read-gate → service write | identical pattern | none |

**Do not** call `services/orders.ts` helpers (`getById`, `listForSession`, `findEditableForSession`,
`create`, `edit`, …) **directly** from a tenant page — they use the service client and take a bare id.
They are for the AI-orchestrator/tool path, not the authenticated dashboard. The dashboard's only entry
points are the four actions above.

### 3.3 "My Business" settings — `src/app/admin/clients/[id]/intake/actions.ts` → `updateIntakeAction`

This is the intake wizard reused as the client's self-serve business settings (docs/10 §9). It is the
**one place that needs schema + code hardening**, because:

- It `UPDATE`s `public.tenants`. `tenants_write` RLS is `is_platform_admin()` **only**, so for a
  `tenant_admin` the update matches **0 rows and returns no error** — the save **silently no-ops**. Fix
  = the optional migration in §7 (`0018`).
- It takes `tenantId` as a **parameter**. For a tenant caller that parameter must be asserted against
  membership (Layer 2), because the new self-write policy will make the row writable.

**Add (required before exposing this screen to tenants):**
```ts
export async function updateIntakeAction(tenantId, _prev, formData) {
  const ctx = await getCallerContext();
  if (!ctx) throw new Error('Unauthorized.');
  assertTenantAccess(ctx, tenantId);                          // ← NEW
  if (!ctx.isPlatformAdmin &&
      !ctx.memberships.some(m => m.tenantId === tenantId && m.role === 'tenant_admin')) {
    throw new Error('Forbidden: only a tenant admin may edit business settings.');   // ← NEW (role gate)
  }
  // …unchanged body…
}
```
> If the inbox+orders MVP ships **without** the My-Business screen (recommended first cut, §11), this
> action and migration `0018` are **not** on the critical path.

### 3.4 The dangerous agency actions must be admin-locked in-body

`createTenantAction` and `updateTenantAction` (`src/app/admin/clients/actions.ts`) write **every**
tenant column — `meta_page_id`, `is_active`, Vault secret refs, widget keys. Today they lean purely on
`tenants_write` RLS = admin. **Once `0018` adds a tenant self-write path, RLS alone no longer stops a
`tenant_admin`**, and a Next.js Server Action is invokable by anyone who can reach its action id — so add
an explicit guard at the top of **both**:
```ts
const ctx = await getCallerContext();
if (!ctx?.isPlatformAdmin) throw new Error('Forbidden.');
```
The tenant UI must never import or expose these two; the only tenant-facing tenant-writer is
`updateIntakeAction` (business-config columns only).

---

## 4. Auth & routing split

### 4.1 Recommended shape: a parallel `/dashboard` tree; `/admin/*` stays admin-only

Two options were considered:

- **(A) Same `/admin/*` tree, branch inside `admin/layout.tsx`** — matches the literal wording of
  docs/07 & docs/10 §9. **Rejected as the primary mechanism:** every agency-only page
  (`/admin` overview, `/admin/clients`, `/admin/settings`) would then have to be individually guarded,
  and forgetting one silently exposes cross-tenant framing. It makes leakage a per-page opt-out.
- **(B) Parallel `/dashboard/*` tree for tenants; keep `/admin/*` hard-gated on `is_platform_admin`.**
  **Recommended.** A tenant literally cannot load an agency route, so isolation is *structural*, not
  per-page discipline. It still reuses the same actions and components (§8). This realizes locked
  decision #4 ("RLS supports both") more safely; it does not change the data model or the decision.

`src/proxy.ts` (optimistic redirect only — **not** the security boundary) extends its matcher to cover
both trees: `matcher: ['/admin/:path*', '/dashboard/:path*']`. Real gating stays server-side.

### 4.2 Layout gates

```
src/app/admin/layout.tsx      (MODIFY — minimal)
  ctx = getCallerContext()
  !ctx                         → redirect('/login')
  ctx.isPlatformAdmin          → render agency shell (unchanged AdminNav)
  else if memberships.length   → redirect('/dashboard')     // a client hit an agency URL
  else                         → "Access pending" screen (unchanged)

src/app/dashboard/layout.tsx  (NEW)
  ctx = getCallerContext()
  !ctx                         → redirect('/login')
  memberships.length === 0 && !isPlatformAdmin → "Access pending"
  activeTenantId = resolveActiveTenant(ctx, cookie)         // §4.3
  render DashboardNav (My Inbox / My Orders / My Business*) scoped to activeTenantId
       (* My Business only when the active membership role === 'tenant_admin')
```
A platform admin visiting `/dashboard` may be redirected to `/admin` (or allowed through for QA — your
call; default: redirect to `/admin`). No agency-only component (`AdminNav`, Overview, Clients list,
Settings) is imported anywhere under `/dashboard`.

### 4.3 Deriving the authoritative `tenantId` per request (and multi-membership)

The schema supports multiple memberships per user, so:

- **0 memberships, not admin** → "Access pending".
- **Exactly 1 membership** → `activeTenantId = memberships[0].tenantId`. No switcher.
- **≥2 memberships** → render a small tenant switcher. Persist the choice in a cookie
  `cn_active_tenant`, but **re-validate it against `ctx.memberships` on every request** and fall back to
  `memberships[0]` if the cookie value is not a current membership. The cookie is a *convenience*, never
  the *authority* — scoping is always `assertTenantAccess(ctx, activeTenantId)` first.

```ts
function resolveActiveTenant(ctx: CallerContext, cookieTenantId: string | undefined): string {
  if (cookieTenantId && ctx.memberships.some((m) => m.tenantId === cookieTenantId)) return cookieTenantId;
  return ctx.memberships[0]?.tenantId;   // caller guarantees ≥1 membership here
}
```

The active `tenantId` is passed **down** to server reads as an explicit `.eq('tenant_id', activeTenantId)`
filter *in addition to* RLS (belt-and-suspenders; RLS already scopes, but the explicit filter also picks
the single active tenant for a multi-membership user).

---

## 5. Tenant-scoped data reads for the new pages

The new `/dashboard` pages mirror `admin/chat/page.tsx` and `admin/orders/page.tsx` but (a) use the
caller's own access token for Realtime and (b) filter to the single active tenant. RLS already prevents
cross-tenant leakage; the explicit `.eq` selects the active tenant for multi-membership users and makes
intent obvious.

```ts
// src/app/dashboard/chat/page.tsx  (NEW)
const ctx = await getCallerContext();                 // layout already gated; re-derive (cached)
const activeTenantId = resolveActiveTenant(ctx!, (await cookies()).get('cn_active_tenant')?.value);
const supabase = await createSupabaseServerClient();
const { data: { session } } = await supabase.auth.getSession();   // caller's OWN token for Realtime
const [{ data: sessions }, { data: tenantRow }] = await Promise.all([
  supabase.from('chat_sessions')
    .select('id, tenant_id, platform, external_user_id, is_human_handoff, alert_signal, last_message_at, unread_count, created_at')
    .eq('tenant_id', activeTenantId)                  // explicit; RLS also enforces
    .order('last_message_at', { ascending: false }).limit(100),
  supabase.from('tenants').select('id, business_name, system_prompt, catalog_data')
    .eq('id', activeTenantId).single(),               // RLS returns only if member; single tenant
]);
// feed a SCOPED session list + the reused ConversationPane (§8)
```
Realtime is safe with **no channel-name scoping**: `postgres_changes` re-applies table RLS per subscriber
and the token is the caller's own, so a tenant member only ever receives their tenant's rows. Do **not**
hand the browser a platform-admin token or another user's token.

---

## 6. Other cross-tenant leak vectors found (checklist for the implementer)

1. **Service-role reads in an authenticated path (primary vector).** Forbid `createServiceClient()`
   anywhere under `/dashboard`. Forbid calling `services/tenants.getById(idFromParam)` /
   `services/orders.getById|listForSession|findProofTarget(...)` from tenant routes — they bypass RLS and
   take a bare id (`tenants.getById(x)` returns *any* tenant regardless of membership).
2. **Trusting a URL/param/cookie `tenant_id` for scoping.** Always re-derive from `ctx.memberships`;
   validate the `cn_active_tenant` cookie every request (§4.3).
3. **Cross-tenant lists fed into reused components.** The reused `Inbox`/`OrdersView` take a `tenants[]`
   prop. If the implementer fetches that with the service client or without the `.eq('id', activeTenantId)`
   filter, other tenants' **names** leak into the UI even though row data is RLS-scoped. Fetch tenant name
   via the RLS client, filtered to the active tenant.
4. **Reusing agency pages whose IA enumerates tenants.** `admin/page.tsx` ("Snapshot … across all
   clients", tenant count), `admin/settings/page.tsx` (platform-admins list, agency config),
   `admin/clients/*`, and `inbox.tsx`'s "Clients" drill-down / "N clients" header **must be absent** from
   the tenant view. See §8.
5. **Deep links / ids in URLs** (`/admin/chat?session=…`, order ids): reads are RLS-gated so these
   fail-closed (empty pane) for a non-member — safe. Just never resolve a *name* for an out-of-scope id
   via the service client.
6. **`updateTenantAction` / `createTenantAction`** — see §3.4; must be admin-locked in-body once `0018`
   lands.
7. **Realtime token bridge** — safe as designed (caller's own token, RLS-filtered). Called out only so a
   reviewer doesn't "fix" it by minting a broader token.
8. **Storage `order-media`** (`0016`) — private bucket; SELECT RLS also uses `user_can_access_tenant` on
   the `<tenant_id>/…` key prefix; the app mints short-TTL signed URLs server-side after an RLS gate. No
   change needed; do not add a public read path.
9. **`usage_logs` vs `webhook_events`** — `usage_logs_select` is member-readable (fine to show a tenant
   their own usage later); `webhook_events_select` is **admin-only** — never surface it in the tenant view.

---

## 7. Does `tenants_write` need a new RLS policy?

**For the inbox + orders MVP: no.** Every inbox/orders write is either (a) an RLS-authorized write on
`chat_sessions`/`chat_messages` (already permitted to members by `0006`), or (b) a read-gated
service-role write on `orders` (gated by the member's RLS read). None of them touches `tenants`.

**For the self-serve "My Business" screen (docs/10 §9): yes** — otherwise `updateIntakeAction` silently
no-ops for a `tenant_admin` (§3.3). This is delivered as **optional** migration `0018` (created alongside
this doc). It is **scoped to `tenant_admin` members** (not `tenant_agent`) and **UPDATE only** (no
tenant INSERT/DELETE by tenants).

### 7.1 The migration (created: `supabase/migrations/0018_tenant_self_serve_write.sql`)
Postgres OR-combines permissive policies, so this **adds** a tenant-admin UPDATE path on top of the
existing admin-only `tenants_write`:
```sql
create policy tenants_update_self on public.tenants
  for update to authenticated
  using      ( exists (select 1 from public.user_tenants ut
                       where ut.user_id = auth.uid()
                         and ut.tenant_id = public.tenants.id
                         and ut.role = 'tenant_admin') )
  with check ( exists (select 1 from public.user_tenants ut
                       where ut.user_id = auth.uid()
                         and ut.tenant_id = public.tenants.id
                         and ut.role = 'tenant_admin') );
```

### 7.2 Row-level ≠ column-level — the required app-layer compensations
This policy makes the **whole** tenant row writable by a `tenant_admin`. RLS cannot restrict *columns*.
The design stays safe because the **only** tenant-facing writer, `updateIntakeAction`, sets business-config
columns only, and the two all-column agency writers are **admin-locked in-body** (§3.4). Ship `0018`
**with** the §3.4 guards, not before.

### 7.3 If you later need hard column-level isolation
Replace `tenants_update_self` with a `security definer` RPC (e.g. `public.tenant_update_business_config(
p_tenant_id uuid, …)`) that checks membership+role internally and updates a **fixed whitelist** of
columns, keeping `tenants_write` admin-only. More work (the intake save path diverges from the agency
path), so it is deferred unless a tenant is ever allowed to edit sensitive columns.

---

## 8. Reuse vs build

**Reuse as-is (import directly, zero change):**
- `src/app/admin/chat/actions.ts` — all four actions (§3.1). Tenant-safe under RLS.
- `src/app/admin/orders/actions.ts` — all actions (§3.2). Tenant-safe under RLS.
- `OrdersView`, `PendingOrderDetail`, `PaymentCell`, `OrderAttachmentPreview` (`orders-view.tsx`) —
  already tenant-agnostic. For a single-tenant view, hide the "Business" column via a
  `showBusinessColumn?: boolean` prop (default true; pass `false` from `/dashboard/orders`), or accept the
  one redundant column. This is the smallest reuse win.

**Reuse by extraction (refactor that does not change agency behavior):**
- `ConversationPane`, `MessageAttachmentPreview`, `SessionAvatar` are **local, un-exported** functions in
  `src/app/admin/chat/inbox.tsx`. Extract them to a shared module (e.g.
  `src/app/_shared/inbox/conversation-pane.tsx`) and have the agency `inbox.tsx` import them unchanged.
  The tenant inbox then renders the **same** `ConversationPane` beside a new scoped list (below).

**Build new (must NOT reuse the agency versions):**
- A **scoped session-list** left pane for `/dashboard/chat` — a flat list of the active tenant's sessions
  grouped by platform, with the alert/handoff/unread badges. It must **not** contain the "Clients"
  drill-down, the "N clients · M conversations" header, or any tenant enumeration. (A tenant user must
  never see a list of other tenants — this is the single most important UI rule here.)
- `src/app/dashboard/layout.tsx` + `DashboardNav` (My Inbox / My Orders / My Business*) — no
  Overview/Clients/Settings entries.
- `/dashboard/chat/page.tsx`, `/dashboard/orders/page.tsx`, and (if in scope) `/dashboard/business/page.tsx`
  reusing `intake-form.tsx` + the hardened `updateIntakeAction`.
- `src/lib/auth/context.ts` (§2), the tenant switcher for multi-membership (§4.3), and the invite action
  (§9).

**Never present to a tenant:** `admin/page.tsx` (cross-tenant overview), `admin/settings/page.tsx`
(platform admins + agency config), `admin/clients/*` (all tenants + client create/edit dialogs),
`AdminNav`, and `inbox.tsx`'s tenant-grouping pane.

---

## 9. Provisioning the first client accounts

**Current reality:** login is password sign-in only (`(auth)/login/actions.ts`), there is **no**
self-signup, and **no code path anywhere creates a `user_tenants` row** — the Settings page literally
says access is granted from the Supabase dashboard. A profiles row is auto-created for a new auth user by
the new-user trigger with `is_platform_admin=false`.

**Recommendation: a minimal "Invite client login" admin action — not raw SQL, not a full invite system.**
Raw SQL/dashboard provisioning is error-prone in the one way that matters most here: mis-linking a user
to the **wrong** `tenant_id` is a direct cross-tenant leak. A ~30-line admin action removes that class of
mistake and is far cheaper than a Phase-2 invite/seat-management UI. Concretely, on
`/admin/clients/[id]`:

```ts
// src/app/admin/clients/[id]/invite/actions.ts  (NEW, 'use server')
export async function inviteClientLoginAction(tenantId: string, formData: FormData) {
  const ctx = await getCallerContext();
  if (!ctx?.isPlatformAdmin) throw new Error('Forbidden.');       // admin-only
  const email = String(formData.get('email') ?? '').trim();
  const role = (String(formData.get('role') ?? 'tenant_admin')) as MemberRole; // admin | agent

  const svc = createServiceClient();                              // server-only
  // If SMTP is configured, invite-by-email (built-in set-password flow):
  const { data, error } = await svc.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${env.NEXT_PUBLIC_APP_URL}/login`,
  });
  // else fall back to: svc.auth.admin.createUser({ email, password: <generated>, email_confirm: true })
  if (error || !data?.user) throw new Error(error?.message ?? 'Invite failed.');

  // Link membership. user_tenants_write RLS admits platform admins, so the RLS
  // client works too; the service client is fine here as well.
  const { error: linkErr } = await svc.from('user_tenants')
    .insert({ user_id: data.user.id, tenant_id: tenantId, role });
  if (linkErr) throw new Error(linkErr.message);
  revalidatePath(`/admin/clients/${tenantId}`);
}
```
Use `inviteUserByEmail` when SMTP is set up; otherwise `admin.createUser` with a generated one-time
password handed to the agency. Do **not** build custom invite-acceptance pages, resend/revoke, or seat
management now — that is Phase-2 billing-adjacent scope. The default role for a client owner is
`tenant_admin`; extra staff are `tenant_agent` (inbox + orders, no business editing).

---

## 10. Two-tenant isolation test (must pass before ship)

Mirror the Phase-1 acceptance criterion (`07-PHASES.md`): create tenants A and B, a `tenant_admin` for A,
and a session/order under each. Signed in as A's admin, verify: `/dashboard/chat` and `/dashboard/orders`
show **only** A's rows; `getMessagesAction(Bsession)` / `takeOverAction(Bsession,…)` /
`approveOrderAction(Border)` all throw/return empty; `/admin`, `/admin/clients`, `/admin/settings`
redirect away (not viewable); Realtime delivers only A's inserts; and (if `0018` applied)
`updateIntakeAction(Btenant, …)` is rejected by `assertTenantAccess` while `updateIntakeAction(Atenant,…)`
succeeds and actually persists.

---

## 11. Implementation checklist (in order, for Sonnet)

1. **`src/lib/auth/context.ts`** (NEW) — `getCallerContext()` + `assertTenantAccess()` (§2).
2. **`src/app/_shared/inbox/conversation-pane.tsx`** (NEW) — extract `ConversationPane` +
   `MessageAttachmentPreview` + `SessionAvatar` out of `admin/chat/inbox.tsx`; update `inbox.tsx` to
   import them (agency behavior unchanged) (§8).
3. **`src/app/admin/layout.tsx`** (MODIFY) — use `getCallerContext()`; admin → agency shell; else member
   → `redirect('/dashboard')`; else → "Access pending" (§4.2).
4. **`src/proxy.ts`** (MODIFY) — matcher `['/admin/:path*','/dashboard/:path*']` (§4.1).
5. **`src/app/dashboard/layout.tsx`** + **`dashboard-nav.tsx`** (NEW) — scoped shell + nav; active-tenant
   resolution + switcher for multi-membership (§4.2–4.3).
6. **`src/app/dashboard/chat/page.tsx`** + scoped session-list component (NEW) — RLS reads filtered to
   `activeTenantId`; reuse the extracted `ConversationPane`; reuse `chat/actions.ts` as-is (§5, §8).
7. **`src/app/dashboard/orders/page.tsx`** (NEW) — reuse `OrdersView` (pass `showBusinessColumn={false}`);
   reuse `orders/actions.ts` as-is (§8).
8. **`src/app/admin/clients/[id]/invite/actions.ts`** (NEW) + a small invite form on the client detail
   page — admin-only provisioning (§9).
9. *(Only if the "My Business" self-serve screen is in this cut)*:
   a. Apply **`supabase/migrations/0018_tenant_self_serve_write.sql`** (already created) (§7).
   b. Harden **`updateIntakeAction`** with `assertTenantAccess` + `tenant_admin` role gate (§3.3).
   c. Admin-lock **`createTenantAction`** and **`updateTenantAction`** in-body (§3.4).
   d. **`src/app/dashboard/business/page.tsx`** (NEW) reusing `intake-form.tsx`.
10. Regenerate DB types **only if `0018` applied** is not required (it adds no columns/enums) — skip.
11. Run the **two-tenant isolation test** (§10) and `tsc --noEmit`.

> Steps 1–8 are the inbox+orders MVP and require **no migration**. Step 9 is the self-serve
> business-editing add-on and is the only part that touches schema/RLS.
