# 21 — Web Push Notifications  (backlog 4c, second half)

> **`[OPUS]` design pass, 2026-07-27.** handoff.md §4c flagged web push as net-new with no spec:
> "VAPID keys, a service worker in `public/`, a `push_subscriptions` table, a subscribe UI in the
> dashboard, and send-on-notify wiring into `services/notifications.ts`." This doc freezes the design
> decisions; the build follows in the same pass. Everything marked **DECIDED** below is settled — do
> not re-litigate without a new Opus pass.

---

## 1. What this adds, and what it deliberately does not

`services/notifications.ts#notify()` already fans an event out to **two** sinks: an in-app row
(`notifications` table → dashboard bell) and **email** (Resend, best-effort, filtered by each
recipient's `profiles.notification_prefs`). Push becomes a **third sink on that same seam** — same
call site, same per-recipient preference filtering, same best-effort posture.

**Non-goals, explicitly:**

- **No offline caching / full PWA service worker.** `src/app/manifest.ts` already ships a PWA
  manifest and its comment states the deliberate reason there is no service worker: *"the app is
  realtime-dependent, so a stale cache would mislead."* That reasoning still holds. The service
  worker added here handles **`push` and `notificationclick` only** — it registers no `fetch`
  handler at all, so it cannot serve stale content. This is the narrowest possible SW.
- **No push for customers.** This is operator/owner-facing only (platform admins + tenant members),
  same audience as the existing in-app and email sinks. Customers are reached over their own
  channel (WhatsApp/IG/web widget), never browser push.
- **No new notification types.** Push rides the existing `NotificationType` union.

---

## 2. Decisions  `[OPUS]` — DECIDED

### 2.1 Use the `web-push` library — DECIDED

This codebase has a real zero-dependency convention (`services/email.ts`: *"deliberately with no
`resend` npm dependency"*). **That convention is correctly overridden here.** Resend is a plain
authenticated JSON POST — a `fetch` wrapper is genuinely equivalent. Web Push is not: it requires
ECDH P-256 key agreement, HKDF derivation, AES-128-GCM payload encryption (RFC 8188), and a signed
VAPID JWT per request. Hand-rolled crypto here fails *silently* or *only on some browsers* — the
worst possible failure mode for a notification system whose whole job is being reliable.

`web-push` is the standard, mature implementation. One dependency, server-only, never bundled to the
client.

### 2.2 Which events push — DECIDED: urgent-only

Push is **interruptive**. Pushing everything trains operators to ignore it, which destroys the value
of the two events that genuinely need someone *now*:

| Type | Pushes? | Why |
|---|---|---|
| `handoff` | **yes** | A customer explicitly asked for a human, or the AI escalated. Someone must act. |
| `alert_signal` | **yes** | Customer is frustrated / at cancellation risk. Time-sensitive save. |
| everything else | no | `new_order`, `review`, `order_updated`, `media_review`, `payment_proof`, `channel_request`, `upgrade_request`, `system_alert`, `follow_up_due` — all real, none worth a phone buzz. In-app + email already cover them. |

The allowlist lives in `PUSH_ELIGIBLE_TYPES` (`lib/constants.ts`). Widening it is a product decision,
not a code cleanup — it is deliberately a single named constant so a future change is explicit and
reviewable rather than incidental.

**Per-user override still applies.** A recipient who has muted `handoff` via
`notification_prefs.muted_types` gets no push for it, exactly as they get no email. Push respects the
existing preference model rather than inventing a parallel one.

### 2.3 iOS requires Add-to-Home-Screen — DECIDED: ship both, guide iOS

On iOS, `PushManager` is **unavailable in a normal Safari tab**. Push works only after the user
manually does **Share → Add to Home Screen** (iOS 16.4+). There is no programmatic install prompt on
iOS, so a bare "Enable push" toggle would silently do nothing for a large share of a mobile-first,
owner-operated user base.

Therefore the subscribe UI has **three states**, not two:

1. **Supported & installable now** (Android/desktop, or iOS already installed to home screen) →
   normal Enable/Disable toggle.
2. **iOS Safari, not yet installed** → no dead toggle. Show the actual instruction: *"On iPhone,
   add CrewNest to your Home Screen first (Share → Add to Home Screen), then turn this on."*
3. **Genuinely unsupported browser** → a plain "not supported on this browser" line.

Detection is capability-based (`'serviceWorker' in navigator && 'PushManager' in window`) plus a
`display-mode: standalone` check for the iOS-installed case — **never** user-agent sniffing.

### 2.4 Subscription lifecycle — DECIDED

- **One row per (user, endpoint).** A person legitimately has several devices (phone + laptop); each
  browser gives its own endpoint. Unique on `endpoint`, which is globally unique by construction.
- **Subscriptions expire and get revoked out-of-band.** The push service returns **404 or 410 Gone**
  for a dead endpoint. On those two statuses specifically, **delete the row** — that is the only
  authoritative signal a subscription is gone. Any *other* error (network, 5xx, timeout) is logged
  and left alone; deleting on a transient blip would silently unsubscribe a working device.
- **Unsubscribe is two-sided**: the browser drops its `PushSubscription` and the server deletes the
  row. If either half fails the other still proceeds — a stale row is pruned on next send (above),
  and a stale browser subscription simply stops receiving.
- **Sends are best-effort and parallel**, never blocking `notify()`'s caller, matching the email
  fan-out's posture exactly.

### 2.5 Security posture — DECIDED

- `push_subscriptions` is **RLS-enabled, owner-scoped**: a user may only see or delete their own
  rows (`user_id = auth.uid()`). Sends happen service-role, like every other server-side fan-out.
- The **VAPID private key is server-only** (`VAPID_PRIVATE_KEY`), never `NEXT_PUBLIC_*`. Only the
  **public** key reaches the browser (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`) — that asymmetry is the whole
  point of VAPID and is safe by design.
- **Push payloads carry no customer PII and no message content** — title, a short generic body, and
  the in-app `link`. This matches the existing fleet-snapshot rule (docs/20 §2.1.4): a push payload
  lands on a lock screen, which is the least controlled surface in the whole product.
- Push is a **bolt-on, not a dependency**: a no-op whenever the VAPID env vars are unset, exactly
  like Resend/Sentry. The app must run identically with push unconfigured.

---

## 3. Schema — migration `0037_push_subscriptions.sql`

```sql
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
```

RLS: enabled; `push_subscriptions_select` and `push_subscriptions_delete` for `authenticated` using
`user_id = auth.uid()`. **No insert policy** — inserts go through the service client in a server
action that binds `user_id` from the session, never from client input (same posture as
`teamMembers.ts`: "callers must bind the id server-side").

---

## 4. Components

| File | Role |
|---|---|
| `supabase/migrations/0037_push_subscriptions.sql` | table + RLS (§3) |
| `public/sw.js` | service worker: `push` → `showNotification`, `notificationclick` → focus/open the link. **No `fetch` handler.** |
| `src/services/push.ts` | `server-only`. `sendPushToUsers()` — VAPID send via `web-push`, prunes on 404/410 (§2.4) |
| `src/services/notifications.ts` | `emitPushFanOut()` alongside `emitEmailFanOut()`, gated on `PUSH_ELIGIBLE_TYPES` |
| `src/lib/push/actions.ts` | `'use server'`: `savePushSubscriptionAction` / `deletePushSubscriptionAction` |
| `src/components/account/push-toggle.tsx` | client component, the three-state UI from §2.3 |
| `src/lib/constants.ts` | `PUSH_ELIGIBLE_TYPES` |

**Env:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:`), plus
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` for the browser. All optional — unset ⇒ push silently disabled.

---

## 5. Acceptance criteria

- [ ] Toggling on in the dashboard prompts for permission, and a row appears in `push_subscriptions`.
- [ ] A `handoff` notification delivers a push to that browser; a `new_order` does **not** (§2.2).
- [ ] A user who muted `handoff` in their prefs gets no push for it.
- [ ] Toggling off removes the row and stops delivery.
- [ ] A dead/expired endpoint (410) is pruned automatically on the next send; a transient 5xx is not.
- [ ] With the VAPID env vars unset, the whole app behaves exactly as before (push is a no-op).
- [ ] The service worker registers no `fetch` handler — verified by reading `public/sw.js`; the
      no-offline-caching guarantee in `manifest.ts` still holds.
- [ ] Push payloads contain no customer name, phone, or message content.
- [ ] `tsc --noEmit`, `eslint`, `vitest`, and `npm run build` all green.
