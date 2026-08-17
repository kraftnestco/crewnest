# 24 — Appointment Booking (service businesses)

**Status:** design, pending implementation
**Extends:** docs/09 (tool-calling + orders, the structural precedent), docs/12 §4 (business hours).

---

## 1. What this is

Service businesses (`tenants.business_type = 'service'`) currently get one thing for scheduling: a
`booking_link` the AI hands over as a URL. The conversation ends at a link — the AI can't see
availability, can't confirm anything, and never learns whether a booking happened.

This replaces that with real in-chat booking: the AI offers concrete slots, books one, and confirms
it, the same way `create_order` works for product businesses.

**Two paths, chosen per tenant at intake:**

| Path | Who it's for | Meeting location |
| --- | --- | --- |
| **A — own link** | Business already has a Zoom room / Meet room / physical address | Their fixed link or address, attached to every booking |
| **B — Cal.com** | Business has nothing | A fresh Google Meet URL minted per booking via Cal.com |

**ClerkNest owns scheduling in BOTH paths.** Availability, slot computation, conflict prevention and
the appointments table are ours. Cal.com is a *meeting-link generator* for path B and nothing more.

### 1.1 Why Cal.com does not own scheduling — the decisive constraint

Verified live 2026-08-03 against a real Cal.com account: the API works end to end (slots → book →
Meet URL → cancel, all confirmed). Letting Cal.com own scheduling would genuinely be less code.

It is still wrong here, for one reason: **ClerkNest owns ONE Cal.com account for all tenants.** Cal.com
availability is a property of that account, so every tenant would share one calendar. Two different
businesses booking "Tuesday 3pm" would collide with each other — a defect that appears the moment
there are two service tenants, and gets worse from there.

Per-tenant Cal.com accounts would fix it, but that means every business owner creating and connecting
an account during onboarding, which defeats the point of path B (it exists precisely for businesses
that have nothing).

So: ClerkNest computes slots per tenant from that tenant's own hours; Cal.com is called only to mint a
link for a booking that has *already* been decided.

---

## 2. Data model

### 2.1 New table `appointments` (migration `0042`)

A separate table, not extra columns on `orders`. Bookings carry genuinely different fields (a start
instant, a duration, a meeting URL; no line items, quantities, or payment status) and roughly half of
`orders`' columns would be permanently null for them.

| column | type | note |
| --- | --- | --- |
| `id` | `uuid pk` | |
| `tenant_id` | `uuid not null` | FK → tenants, cascade |
| `session_id` | `uuid` | FK → chat_sessions, `on delete set null` — matches `orders` |
| `appointment_number` | `integer` | Per-tenant sequential, customer-facing. Same rationale and mechanism as `orders.order_number` (migration `0040`) — never show a uuid to a customer |
| `starts_at` | `timestamptz not null` | The instant. Always UTC in the DB; rendered in tenant tz |
| `duration_minutes` | `integer not null` | Snapshotted from tenant config at booking time |
| `status` | `text not null` | `booked` \| `cancelled` \| `completed` \| `no_show` |
| `customer_name` | `text` | |
| `customer_phone` | `text` | |
| `notes` | `text` | Free text from the conversation |
| `service_name` | `text` | Which service, when the tenant offers several |
| `meeting_url` | `text` | Path A: the tenant's fixed link. Path B: the per-booking Meet URL |
| `location_text` | `text` | For in-person: an address |
| `calcom_booking_uid` | `text` | Path B only — needed to cancel the Cal.com side |
| `platform` | `platform` | Channel it was booked from |
| `external_user_id` | `text` | |
| `created_at` / `updated_at` | `timestamptz` | |

**Indexes:**
- `(tenant_id, starts_at)` — the conflict check and the dashboard list both hit this.
- `unique (tenant_id, appointment_number)` — mirrors `orders`.
- **`unique (tenant_id, starts_at) where status = 'booked'`** — a partial unique index. This is the
  real conflict guard: it makes double-booking impossible **in the database**, not merely unlikely.
  See §4.2.

RLS: `select` via `user_can_access_tenant(tenant_id)`; writes service-role only. Identical posture to
`orders` (migration 0009).

### 2.2 New tenant columns

| column | purpose |
| --- | --- |
| `booking_enabled` | boolean, default false. Gates the tools. Separate from `business_type` so a service tenant can decline booking |
| `booking_mode` | `'own_link'` \| `'calcom'`. Path A or B |
| `booking_own_link` | Path A's fixed meeting URL or address |
| `booking_duration_minutes` | integer, default 30 |
| `booking_lead_time_minutes` | integer, default 120. Minimum notice — no booking 5 minutes from now |
| `booking_max_days_ahead` | integer, default 30. How far out the AI will offer |

`booking_link` (the existing external-URL field) is left untouched and unused by this feature. It stays
as the fallback for tenants that never enable booking.

---

## 3. Slot computation

Extends `services/hours.ts`, which already owns weekly hours, holiday closures, and timezone handling
— and is deliberately dependency-free so `aiOrchestrator` can import it. Slot generation belongs in the
same module for the same reason.

New: `computeAvailableSlots({ businessHours, timezone, durationMinutes, leadTimeMinutes, maxDaysAhead, busy, from })`

1. Walk forward day by day from `from` (default: now) up to `maxDaysAhead`.
2. Skip days with no `week` row, and any day inside an active `closures` window — reusing the existing
   `activeClosure` logic, so holidays are honoured for free.
3. Within each open day, step from `open` to `close` in `durationMinutes` increments.
4. Drop any slot starting before `now + leadTimeMinutes`.
5. Drop any slot colliding with a `busy` interval (existing `booked` appointments, passed in by the
   caller — `hours.ts` stays DB-free).

**Overnight ranges** (`20:00`–`02:00`, which `isWithinRange` already supports) generate slots across
midnight. Handled explicitly; a bar or late-night service is a real case.

**DST:** slot *labels* are produced in the tenant's timezone via `Intl`, and the stored `starts_at` is
the resolved UTC instant. A slot is never stored as wall-clock text. Pakistan has no DST, so this is
latent correctness rather than a live concern — but getting it wrong here would be very hard to unpick
later.

---

## 4. The booking flow

### 4.1 Tools

Three, registered in `services/tools/registry.ts` and advertised only when
`tenant.booking_enabled && tenant.business_type === 'service'`:

- **`check_availability(date_hint?)`** — returns a bounded list of human-readable slots
  ("Tue 4 Aug, 3:00 PM"). Capped (≈8) so the model doesn't recite fifty options at a customer.
- **`book_appointment(starts_at, customer_name, customer_phone, service_name?, notes?)`** — books it.
- **`cancel_appointment(appointment_number)`** — cancels, and releases the slot.

Reschedule is deliberately **not** a fourth tool: cancel-then-book is the same two calls the model can
already make, and a dedicated reschedule tool would need its own conflict-and-rollback handling for no
new capability.

`ToolContext` supplies tenant and session identity. The model supplies only booking details — never
ids. Same invariant as every existing tool.

### 4.2 What `book_appointment` does

1. Re-validate the requested `starts_at` against `computeAvailableSlots`. **The model's chosen slot is
   never trusted** — the customer may have taken minutes to reply, and the slot may be gone.
2. Insert the appointment (`status='booked'`). The partial unique index is the actual guard: a
   concurrent booking of the same slot fails with `23505`, which is caught and returned as "that time
   was just taken, here are the next options" rather than surfacing as an error.
3. **Path A:** copy `booking_own_link` into `meeting_url`. Done — no external call.
4. **Path B:** call Cal.com to mint the Meet link, then store `meeting_url` + `calcom_booking_uid`.
5. Notify the owner (`notifyBoth`), reusing the existing notification fan-out.
6. Return a confirmation for the AI to relay, including the number (`#7`) and the meeting link.

### 4.3 Cal.com failure is not booking failure

If step 4 fails — Cal.com down, key revoked, rate limited — **the appointment stays booked.** The
customer is told the time is confirmed and the link will follow. The alternative (roll back a
confirmed booking because a link generator hiccuped) is a far worse outcome: the customer has already
been told a time, and their slot would silently vanish.

A missing `meeting_url` on a `booked` row is a visible, fixable state — the dashboard shows it and
staff can attach a link manually.

### 4.4 Cal.com call shape (verified live 2026-08-03)

Version headers are **per-endpoint** and differ; getting one wrong returns a confusing 400.

| Purpose | Endpoint | `cal-api-version` |
| --- | --- | --- |
| Create booking | `POST /v2/bookings` | `2024-08-13` |
| Cancel booking | `POST /v2/bookings/{uid}/cancel` | `2024-08-13` |

Auth: `Authorization: Bearer $CALCOM_API_KEY`. Body: `{ start, eventTypeId, attendee: { name, email,
timeZone, language } }`. The response carries `meetingUrl` (also mirrored in `location`) and `uid`.

**Attendee email — decided, with a known trade-off.** Cal.com requires an attendee email. A customer
messaging on WhatsApp/Instagram has given us a name and a phone number, never an email, and asking for
one mid-booking is friction for something they don't need.

**Decision: a single fixed ClerkNest address (`CALCOM_ATTENDEE_EMAIL`) is used for every booking**, with
the customer's real name passed through as `attendee.name` so Cal.com's records and the calendar event
still identify them. Verified in testing: the Meet link does not depend on the attendee email being the
customer's.

**Consequence, accepted:** Cal.com's confirmation and reminder emails go to that ClerkNest address, not
to the customer, and every booking across every tenant lands in one inbox. The customer's record of the
appointment is the chat message the AI sends them, which is where they already are. If customers should
later get an emailed confirmation, send it from ClerkNest via the existing Resend integration rather
than by putting a real customer address into Cal.com — that keeps Cal.com as a pure link generator
(§1.1) instead of a second source of truth about the booking.

Rejected: asking the customer for an email (a question in every booking conversation, to serve a
minority who'd notice), and synthetic per-customer addresses like `wa-<phone>@bookings.…` (needs DNS
catch-all setup for no user-visible gain).

Env: `CALCOM_API_KEY`, `CALCOM_EVENT_TYPE_ID`, `CALCOM_ATTENDEE_EMAIL` (all optional in `env.ts` — unset means path B is
unavailable and `booking_mode='calcom'` degrades to "we'll send the link separately", never a crash).

---

## 5. Surfaces

- **`/admin/appointments`** and **`/dashboard/appointments`** — one shared view, mirroring the Orders
  page split (`showBusinessColumn` for the agency view, tenant-scoped for the client). Includes the
  same per-client filter added to Orders.
- **Intake wizard** — a "Bookings" step for service tenants: enable, choose path A or B, own link,
  duration, lead time, window.
- **Business Copilot** — out of scope for v1. Booking config edits stay in the intake wizard.

---

## 6. What this does NOT do

Stated so they're deliberate omissions, not oversights:

- **No staff/resource scheduling.** One bookable calendar per tenant. A salon with three stylists
  cannot book them independently. This is the biggest limitation and the most likely next request.
- **No customer reminders.** Sending "your appointment is tomorrow" needs a scheduled job and, on
  WhatsApp, an approved template (the same blocker as docs' follow-ups item). Deliberately deferred.
- **No payment on booking.** Deposits would ride the existing payment methods; not wired here.
- **No two-way calendar sync.** A tenant blocking time in their own Google Calendar is invisible to
  ClerkNest. Path B writes bookings *to* Cal.com's calendar, but nothing reads back.
- **No reschedule tool** (§4.1).

---

## 7. Build order

1. Migration `0042` — table, tenant columns, indexes, RLS. Hand to owner to run.
2. `database.ts` + `domain.ts` types.
3. `hours.ts` — `computeAvailableSlots` + unit tests (pure function, genuinely testable: DST,
   overnight ranges, closures, lead time, collisions).
4. `services/appointments.ts` — persistence, conflict handling, per-tenant numbering.
5. `services/calcom.ts` — thin client, both endpoints, failure-tolerant.
6. Three tools + registry gating.
7. Prompt block (docs/09 §5 precedent) telling the model to confirm details before booking.
8. Dashboard pages + intake step.

---

## 8. Acceptance criteria

- [ ] A service tenant with `booking_enabled` gets slot offers in chat; a product tenant never does.
- [ ] Offered slots respect business hours, holiday closures, lead time, and the max-days-ahead window.
- [ ] Booking a slot returns a confirmation with a customer-facing number and a meeting link.
- [ ] Path A uses the tenant's own link; path B mints a fresh Google Meet URL.
- [ ] **Two concurrent bookings of the same slot: exactly one succeeds**, and the loser is offered
      alternatives rather than shown an error.
- [ ] A slot that became unavailable mid-conversation is rejected at booking time, not just at offer
      time.
- [ ] Cal.com being unreachable still produces a booked appointment (§4.3).
- [ ] Cancelling frees the slot for rebooking, and cancels the Cal.com side when there is one.
- [ ] Appointments appear in both dashboards, tenant-scoped correctly.
- [ ] `tsc --noEmit`, lint, tests, and `npm run build` all green.
