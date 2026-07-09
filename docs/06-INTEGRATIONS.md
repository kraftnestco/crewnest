# 06 — Integrations

How each channel connects. Phase 1 = WhatsApp + Facebook + Instagram + website chat (text). Shopify
and Voice are stubbed now, built later.

---

## 1. Meta (WhatsApp, Facebook, Instagram)

### 1.1 One app, many tenants
- You operate **one Meta App**. All client Pages/IG accounts/WhatsApp numbers connect to it, so all
  webhooks arrive at **one URL**: `POST https://<app>/api/webhooks/meta`.
- The tenant is resolved from the event's **destination id**:
  - FB Messenger: `entry[].messaging[].recipient.id` = the Page id → `tenants.meta_page_id`.
  - Instagram: `entry[].id` / IG account id → `tenants.instagram_id`.
  - WhatsApp: `entry[].changes[].value.metadata.phone_number_id` → `tenants.whatsapp_phone_number_id`.
- Unknown/inactive destination → log + ignore (never guess a tenant).

### 1.2 Inbound (`GET` verify + `POST` receive)
- **GET** (subscription handshake): if `hub.mode === 'subscribe'` and `hub.verify_token ===
  META_VERIFY_TOKEN` (constant-time compare) → return `hub.challenge` as plain text; else `403`.
- **POST**:
  1. Read the **raw** body (needed for signature).
  2. Verify `X-Hub-Signature-256` = `sha256=` + HMAC-SHA256(rawBody, `META_APP_SECRET`),
     constant-time. Mismatch → `401`.
  3. Parse per product (Messenger / IG / WhatsApp payload shapes differ — normalise into the
     `InboundMessage` shape). Extract `providerMsgId` (`messages[].id` for WA; `message.mid` for
     Messenger/IG).
  4. Insert `webhook_events(provider:'meta', provider_msg_id)` — on unique-violation, it's a
     retry/dup → **ACK 200 and stop**.
  5. **Return 200 now.** Then `after()` → `aiOrchestrator.handleInboundMessage()`.

### 1.3 Outbound (`services/meta/send.ts`)
- Uses the tenant's **decrypted** channel token (from Vault):
  - WhatsApp: `POST https://graph.facebook.com/v21.0/{phone_number_id}/messages`
    (`messaging_product: 'whatsapp'`, `to`, `type:'text'`, `text.body`). Respect the 24-hour
    customer-service window; template messages are a Phase-2 concern.
  - Messenger/IG: `POST https://graph.facebook.com/v21.0/{page_id}/messages`
    (`recipient.id`, `message.text`), `access_token` = page token.
- Pin the Graph API version in one constant. Handle Graph error envelopes; log **metadata** only.

### 1.4 Token model (locked: manual now, OAuth later)
- **Phase 1 (manual):** the onboarding wizard accepts the Page access token / WhatsApp permanent token
  (masked field). It's stored via `set_tenant_secret()` → `tenants.meta_token_secret_id` /
  `whatsapp_token_secret_id`.
- **Phase 2 (embedded signup):** a "Connect with Facebook" flow OAuths the client's assets and writes
  a fresh Vault secret + updates the reference. **Same columns, no schema change.**
- **Launch bottleneck (not code):** routing many clients through one app needs Meta **Business
  verification + Tech Provider + app review + advanced access**, and WhatsApp needs per-number
  registration. Start that paperwork in parallel with the build — it, not the code, gates go-live.

---

## 2. Website chat widget

### 2.1 Endpoint (`app/api/chat/route.ts`, Node runtime)
- Auth: request carries the tenant **public key** (`widget_public_key`) → resolve tenant.
- **Origin allowlist:** reject if `Origin`/`Referer` not in `tenants.widget_allowed_origins`; scope
  CORS headers to the allowed origin.
- **Rate limit** per session/IP (`services/security/rateLimit.ts`) to cap cost/abuse.
- Body: `{ sessionKey, text }`. Runs the **same** `aiOrchestrator`, but returns the assistant reply in
  the HTTP response (optionally streamed) instead of calling Meta. `platform = 'web'`.

### 2.2 Widget script (`public/embed/widget.js`)
- Self-contained, dependency-free JS. A client embeds:
  ```html
  <script src="https://<app>/embed/widget.js" data-crewnest-key="pk_live_xxx" defer></script>
  ```
- Renders a launcher + chat panel, persists a `sessionKey` in `localStorage`, POSTs to `/api/chat`.
- Ships **no** secrets — only the public key. Never receives tenant config.

---

## 3. Shopify (Phase 2 — stub now)

- `app/api/webhooks/shopify/route.ts`: verify base64 `X-Shopify-Hmac-Sha256` over raw body with the
  app secret; on `products/update` etc., patch `tenants.catalog_data` for the tenant matched by
  `shopify_store_url`.
- Phase 1: the wizard lets staff paste/upload catalogue JSON manually — no Shopify dependency to
  launch.

---

## 4. Voice / SIP (Phase 3 — stub now)

- `app/api/webhooks/voice/route.ts`: placeholder that will accept SIP-trunk transcripts, route to the
  orchestrator, and return audio/text instructions. `platform = 'voice'`, routed by `sip_trunk_id`.
- Left as a documented stub returning `501` until Phase 3.

---

## 5. Provider/version constants (single source)
Keep these in `lib/constants.ts`: Graph API version, OpenAI base model, token budgets, rate-limit
windows, catalogue token-stuffing threshold. No magic numbers scattered across services.
