# ClerkNest — Final Pricing Plans

> Implemented in app + marketing. Overage deferred. No watermark.

---

## What is a "conversation"?

A **conversation** is one customer's chat with your AI on one channel.

- All messages in that thread count as **one** conversation while they keep chatting.
- If they go quiet for **24 hours** and message again, that starts a **new** billable conversation.
- A different channel (e.g. WhatsApp then Instagram) is always a separate conversation.
- Limits are **per calendar month** (UTC).

**Example:** Same customer messages Monday and Tuesday (within 24h) → 1 conversation.
They message again on Friday → 2nd conversation.

---

## Plans

| Plan | Price (USD) | Price (PKR, Pakistan) | Conversations / month | Channels |
|------|-------------|----------------------|----------------------|----------|
| **Free** | $0/mo | Rs 0/mo | 50 | 1 |
| **Starter** | $11/mo | Rs 3,000/mo | 500 | 1 |
| **Growth** | $49/mo | Rs 14,000/mo | 2,000 | All 4 |
| **Pro** | $79/mo | Rs 22,000/mo | 10,000 | All 4 |
| **Enterprise** | Custom | Custom | Custom | All 4 · Talk to Sales |

Free also caps at **20 customer messages per conversation**, then hands off + upgrade prompt.

---

## Behaviour at the limit

- Customer gets a polite “limit reached” reply.
- Owner gets an **upgrade notification** (debounced) linking to Billing.
- Dashboard shows remaining conversations this month.

---

## PKR display

Visitors/tenants in **Pakistan** see PKR prices on marketing, signup, onboarding, paywall, and billing.
Checkout still uses fixed Safepay plan amounts (not live FX conversion).

---

## Not in this version

- Overage billing (save for later)
- Watermark on Free replies
