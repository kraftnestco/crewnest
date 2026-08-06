# CrewNest — Client Dashboard Content Inventory

Everything the **client dashboard** (`/dashboard`) contains, for redesign/mockup purposes. This is the
**business owner's** view of their own single business — not the agency `/admin` view.

Content only: what information appears, what actions exist, what states each surface can be in.
No layout, positioning, or styling.

---

## 0. Two things that change what a user sees

Mockups need to account for both, since they change which pages and content exist at all.

**Role** — every member is one of two:
- **`tenant_admin`** (owner) — everything below.
- **`tenant_agent`** (staff) — **only** Home, Inbox, Orders, Appointments, Analytics, Account.
  No Business, Inventory, Team, or Billing. No Copilot.

**Business configuration** — pages appear/disappear based on setup:
- **Appointments** exists only for a *service* business with booking enabled.
- **Orders / payments / inventory** content depends on order-taking and payment toggles.

Also: a user can belong to **more than one business**, which adds a business switcher and an extra
"Business" column in tables.

---

## 1. Global shell (present on every page)

**Brand area** — CrewNest logo/wordmark, byline "By KraftNest Automations", and a badge showing the
**active business name**.

**Business switcher** — only when the user belongs to multiple businesses.

**Navigation** (labels as written; short forms used on mobile):
| Full label | Short | Who sees it |
|---|---|---|
| Home | — | everyone |
| My Inbox | Inbox | everyone |
| My Orders | Orders | everyone |
| Appointments | Bookings | service + booking enabled |
| Analytics | — | everyone |
| My Business | Business | owner |
| Inventory | Stock | owner |
| My Team | Team | owner |
| Billing | — | owner |

**Top bar** — current page title + description, page-specific actions, theme toggle (light/dark),
notification bell, account menu.

**Notification bell** — unread count badge, list of ~20 recent notifications, real-time updating.
Notification types: new order, handoff request, alert signal, channel request, payment proof,
upgrade request, low stock, system alert.

**User area** — signed-in name/email, sign out.

**Blocked state** — a user not yet linked to any business sees only: "Access pending / Your account
isn't linked to a business yet. Ask your CrewNest contact to grant access." + Sign out.

---

## 2. Home

**Greeting** — "Welcome back, {Business Name}" + "Here's what's happening with your AI assistant."

**Daily quota banner** (any plan with a daily cap — Free, Starter, Growth; not Pro) — labelled with the
plan name, e.g. "Starter plan: 3 of 5 new conversations left today" plus a "See plans" link. When
exhausted: "You've used all of today's new-conversation slots. New customers won't get a reply until
tomorrow." + "Upgrade for more". The exhausted state is an alarm state.

**AI assistant upsell** (owners below Growth) — occupies the space where the Copilot would be: "Get
your own AI assistant / On Growth, CrewAI helps you run {Business} — update your catalogue, hours, and
prices just by describing the change." + "See plans".

**Needs attention** — four counters, each linking to the relevant page:
- Pending orders
- Payments to verify
- Live handoffs
- Flagged chats

Zero-state: "All clear ✓". Counters at zero are visually de-emphasised.

**Activity stats:**
- Conversations handled (30 days)
- Active conversations (24 hours)
- Orders this month
- Average rating — score out of 5, star rendering, review count (only if reviews exist)

**Empty state** (no activity yet) — either "Your AI assistant is live on {channels}" or "Your AI
assistant is almost ready", with: "This is where your customer chats and orders will show up once
conversations start coming in."

**The Copilot ("CrewAI")** — for owners **on Growth or Pro** this *is* the home surface, with the stats above folded into
it. See §10.

---

## 3. My Inbox

Live customer conversations across all channels, updating in real time.

**Conversation list** — searchable ("Search customers…"), filterable by channel (WhatsApp, Messenger,
Instagram, Website chat). Each entry: customer avatar, name/identifier, channel, relative time of last
message, and warning indicators for alert signals or flagged chats.

**Conversation view** — full message history, both directions, with timestamps. Messages can carry
**image and voice attachments**. A failed message shows "Not delivered. The customer may not have
received this."

**Human takeover toggle** — the kill switch. Two states, described to the user as either "The AI has
stopped replying. You're answering this chat yourself" or "The AI is currently replying to this
customer."

**Reply box** — "Type a reply…" — the owner sending a message manually.

**Details panel** — Customer ID, Platform, Started (timestamp), Alert (when raised).

**Flags surfaced** — "Needs your input", alert signal reason, handoff state.

**Create order from chat** — an "Order summary" dialog drafted from the conversation, containing:
Items, Customer name, Phone, Address, Notes, Payment method (with "Not decided yet" as an option).
Drafting state: "Drafting from the conversation…"

---

## 4. My Orders

**Status filters** — All · Pending · Confirmed · Fulfilled · Cancelled. Plus a status legend
explaining what each means.

**Order table columns** — Customer · Items · Status · Payment · Platform · Owner alert (whether the
business was notified) · Placed (date) · Chat (link to the conversation) · Review.
Multi-business users get an extra Business column.

**Two independent status axes** — important for the design, they must not look like one scale:
- **Order status:** pending / confirmed / fulfilled / cancelled
- **Payment status:** unpaid / awaiting verification / paid / refunded / failed

An order can legitimately be *confirmed* **and** *unpaid* (cash on delivery).

**Order reference** — customer-facing format like `KN-0803-5`.

**Order detail** — Requested items (with per-item customisation notes), Contact, Notes, Media
(customer-sent photos/voice, with a count), Rating + Feedback + submission time when reviewed.

**Owner actions:**
- Approve — "Confirm this order and notify the customer"
- Reject — with an optional "Reason for rejecting"
- Mark paid / Mark refunded
- Verify payment proof — "Confirm the submitted payment proof is valid"
- Reject payment proof — "…and ask the customer to resubmit"

**Payment proof** — a customer-uploaded receipt image, viewable inline. States include
"Loading media…" and "Media unavailable."

---

## 5. Appointments

*(Only for service businesses with booking enabled.)*

**Table columns** — When · Customer · Status · Meeting (video-call link) · Chat · Actions.

**Content** — upcoming appointments in the business's own timezone, each with a meeting link when one
was generated. "Upcoming" means *not yet finished*, so an in-progress appointment still appears.

**Actions** — cancel/manage an appointment.

---

## 6. Analytics

**Range selector** — 7 days · 30 days · 90 days.

**Headline metrics:**
- Conversations started
- Messages handled
- Deflection rate (% handled without a human) — "No data" when empty
- CSAT — score out of 5, or "Not enough data yet"

**Sentiment health** — a proportional breakdown of active conversations across five buckets, each
with its own colour and a count: **Frustrated · Price objection · Product doubt · Cancellation risk ·
Clear**. Empty state: "No active conversations in this range."

Deliberately excludes cost/spend data — that's agency-only.

---

## 7. My Business *(owner only)*

Header note: "Tell your AI assistant about {Business} and manage which channels it talks to customers
on. Technical setup (API keys, tokens) is always handled by our team."

### Channels
"Where your AI assistant talks to customers." — WhatsApp · Messenger · Instagram · Website chat, each
connected or not. **Request a new channel**, listing what CrewNest needs from the owner, plus
"Anything we should know? (optional)" — e.g. "our WhatsApp number is +92 300 1234567".

### Business details — a 9-step wizard with progress ("Step 3 of 9")
1. **What kind of business is this?** — Product-based or Service-based
2. **Your assistant's personality** — tone: Friendly & warm (default) · Professional & polished ·
   Playful & casual · Calm & premium
3. **What do you sell?** — catalogue, structured or free-form text; import from a URL
4. **Custom orders** — whether customers can request bespoke items, plus instructions
5. **Photos & voice notes from customers** — how to handle images (Match to my catalogue · Accept any ·
   Reject) and voice notes (AI answers on its own · Hold for a human)
6. **Order approval** — whether orders need owner approval before confirming
7. **Common questions** — the knowledge base the AI answers from
8. **Business hours** — weekly hours, timezone, holiday closures
9. **Payments** — enable payments; methods (**Cash on Delivery** · **Bank/Wallet Transfer** ·
   Card/Online Payment); transfer instructions (the owner's own JazzCash/Easypaisa/bank details);
   currency; whether orders are reserved until paid

Saves at any point. A warning appears if booking is enabled but hours/timezone are missing, because
the AI would otherwise tell every customer there's no availability.

---

## 8. Inventory *(owner only)*

Stock levels per catalogue item. Each item shows a stock state: **Not tracked · In stock · Low stock ·
Out of stock**. Actions: set an exact stock number, or quick-restock by a fixed increment.

Empty state: "No catalogue items yet."

Low-stock triggers a notification that deep-links here.

---

## 9. My Team *(owner only)*

"Manage who at {Business} can access this dashboard."

**Table** — Name · Role · Joined, with a per-row remove action.
**Invite** — add a team member by email with a role.
**Remove confirmation** — "Remove {name}?"

---

## 10. The Copilot — "CrewAI" *(owner only, Growth & Pro only)*

A chat that edits the business in plain language. Tagline: "Describe a change in plain words and I'll
draft it for you." Empty state: "How can I help with {Business}?" Input: "Tell me what changed…"

**Nothing applies automatically.** The Copilot *proposes*; the owner applies. Two proposal kinds:

- **"Proposed change"** — an edit to business settings, shown as a diff-style before/after for review.
- **"Proposed action"** — a discrete operation (invite a team member, set stock, restock).

**Proposal states** — pending · applied · **Dismissed** · **"Replaced by a newer change"**.

**Extra warning on money-related changes:** "This changes how customers pay you, so please
double-check it before applying."

**What it can touch** — persona/tone, catalogue, knowledge base, business hours, holiday closures,
business basics, custom orders, media & voice handling, payment configuration, import from a URL,
invite a team member, set/restock inventory, look up a customer.

**What it can never touch** (no proposal will ever appear for these) — AI model/provider, API keys and
secrets, plan and billing, spend caps, account active state, data-retention settings, channel IDs.

---

## 11. Billing *(owner only)*

"Manage your CrewNest plan and payment method."

**Payment-failed alert** — "Payment failed / We couldn't charge your card. Update your payment method
to keep your plan active."

**Four plan cards** — the current one is marked "Current plan"; Growth is marked "Most popular":
- **Free — $0/mo** — "Keep the AI you just built, capped for solo testing." · Up to 5 customer
  conversations/day · Up to 20 messages per conversation · One channel at a time · Community support
- **Starter — $39/mo** — "For a business that outgrew the free cap." · Up to 5 customer
  conversations/day · Conversations of any length · All channels — WhatsApp, Instagram, Messenger &
  web · Order capture & payments
- **Growth — $49/mo** — "For a business handling real daily volume." · Everything in Starter · Up to
  20 customer conversations/day · **Your own AI assistant to run the business** · Order capture &
  payments
- **Pro — $79/mo** — "For teams who want the full command center." · Everything in Growth · Unlimited
  customer conversations · Multiple team seats & roles · Priority support

Each non-current paid plan has an action: **"Choose {plan}"** for an upgrade, **"Switch to {plan}"**
(outlined, visually softer) for a downgrade. Both lead to hosted checkout.

**Prices display in the local currency** — USD internationally, PKR for Pakistani businesses
(Starter Rs 11,000 · Growth Rs 14,000 · Pro Rs 22,000).

**Manage subscription** — content differs by region:
- International: "Update your payment method, view invoices, or cancel your subscription." →
  *Manage billing*
- Pakistan: "To change your payment method, cancel and resubscribe. Cancelling moves you to the Free
  plan at the end of your current billing period." → *Cancel subscription*, with a confirmation step.

**Prices display in the local currency** — USD internationally, PKR for Pakistani businesses.

---

## 12. Account

"Manage your profile, password, and notification preferences."

- **Profile** — Full name (editable), Email (read-only: "Contact us to change your email address.")
- **Change password** — New password, Confirm new password
- **Notification preferences** — "Email me / Also send these notifications to your email", plus
  per-type toggles

---

## 13. Cross-cutting states worth designing

- **Loading** — several pages have dedicated loading states
- **Empty** — most surfaces have a distinct first-run empty state; these matter, since a new business
  sees them all
- **Real-time updates** — inbox, orders, and notifications change *while the user is looking at them*
- **Failure** — undelivered message, unavailable media, failed payment
- **Attention/alarm** — handoff needed, flagged chat, quota exhausted, low stock, payment failed
- **Mobile** — nav collapses to a five-item bottom bar (Home · Inbox · Orders · Analytics · Business);
  Inventory, Team, and Billing are reachable but not in the bar
- **Light and dark themes** — both are supported and toggleable
