/**
 * Single source of truth for tunable constants. No magic numbers in services.
 * See docs/06-INTEGRATIONS.md §5.
 */

/** Meta Graph API base (version comes from env.META_GRAPH_VERSION at call sites). */
export const META_GRAPH_BASE = 'https://graph.facebook.com';

/** Default LLM provider/model when a tenant has not overridden them. */
export const DEFAULT_LLM_PROVIDER = 'openai';
export const DEFAULT_LLM_MODEL = 'gpt-4o-mini';

/**
 * Stopgap (2026-07-20): MASTER_OPENAI_KEY in Vercel Production is a placeholder,
 * so the public demo (which always runs on the master key, never BYOK) is routed
 * through OpenRouter's master key instead until a real OpenAI key is set. Model id
 * is OpenRouter's vendor-prefixed format — same underlying model, tool-calling
 * capable. Scoped to the demo route only; real tenants are untouched.
 */
export const DEMO_LLM_PROVIDER = 'openrouter';
export const DEMO_LLM_MODEL = 'openai/gpt-4o-mini';

/**
 * Voice-note transcription models + endpoint. OpenAI tenants (and any tenant with an
 * OpenAI BYOK key) use OpenAI's `gpt-4o-transcribe`; OpenRouter tenants use OpenRouter's
 * OpenAI-compatible `/audio/transcriptions` endpoint (added 2026) with Whisper, so voice
 * works WITHOUT a funded OpenAI key — the master OpenAI key is a placeholder in prod
 * (see DEMO_LLM_* above). Resolved by `lib/secrets.ts#getTranscriptionConfig`.
 */
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const TRANSCRIBE_MODEL_OPENAI = 'gpt-4o-transcribe';
export const TRANSCRIBE_MODEL_OPENROUTER = 'openai/whisper-large-v3';

/**
 * Cross-turn image memory: images ride only the turn they arrive on (the prompt-cache
 * contract), so a later "the picture I sent you" is invisible to the model. When a turn
 * brings no new image, the orchestrator re-attaches the single most recent image shared
 * within this window so the reference resolves — capped to bound vision-token cost.
 */
export const RECENT_IMAGE_REATTACH_WINDOW_MINUTES = 60;

/** Short-term memory: how many prior messages to load, and the dynamic-tail token budget. */
export const MEMORY_WINDOW_MESSAGES = 16;
export const MEMORY_TOKEN_BUDGET = 4000;

/**
 * Stage U-mem (docs/18 §2) — rolling conversation summary, folded into the dynamic
 * tail once a session outgrows the live window. `SUMMARY_TOKEN_CAP` bounds the
 * digest itself; `SUMMARY_SOURCE_FETCH_LIMIT` bounds how many dropped-off messages
 * a single refresh call folds in (a session with a huge one-time backlog catches up
 * over a few turns instead of one giant call). The model is a FIXED cheap one per
 * provider, independent of the tenant's configured (possibly pricier) `llmModel` —
 * this is a background digest, not a customer-facing reply.
 */
export const SUMMARY_TOKEN_CAP = 250;
export const SUMMARY_SOURCE_FETCH_LIMIT = 200;
export const SUMMARY_MODEL_BY_PROVIDER: Record<string, string> = {
  openai: DEFAULT_LLM_MODEL,
  openrouter: DEMO_LLM_MODEL,
};

/**
 * Catalogue stuffing threshold (approx tokens). Above this, switch promptBuilder
 * to retrieval mode (pgvector) — Phase 3. Below, stuff into the cached prefix.
 */
export const CATALOG_STUFF_TOKEN_LIMIT = 40_000;

/** The control token the assistant emits to request human takeover. */
export const HUMAN_HANDOFF_TOKEN = '[HUMAN_HANDOFF]';

/**
 * Control tokens the assistant may append to a reply to flag a Live Inbox
 * alert — same mechanism as HUMAN_HANDOFF_TOKEN (see promptBuilder's
 * GUARDRAIL_RULES + services/security/sanitize.ts), one extra signal per turn.
 */
export const SIGNAL_TOKENS = {
  frustrated: '[SIGNAL_FRUSTRATED]',
  price_objection: '[SIGNAL_PRICE_OBJECTION]',
  product_doubt: '[SIGNAL_PRODUCT_DOUBT]',
  cancellation_risk: '[SIGNAL_CANCELLATION_RISK]',
} as const satisfies Record<import('@/types/domain').AlertSignal, string>;

/** Website widget rate limiting, keyed per (tenant, session). */
export const WIDGET_RATE_LIMIT = { windowMs: 60_000, max: 20 } as const;

/**
 * Public demo session cap (docs: "try it for your business" plan, Phase B),
 * keyed per visitor IP. One check per demo session start (email-capture
 * submit), not per chat message — the demo chat route itself is unmetered.
 */
export const DEMO_SESSION_RATE_LIMIT = { windowMs: 24 * 60 * 60 * 1000, max: 6 } as const;

/**
 * Tenant-wide fallback bucket for the website widget. sessionKey is entirely
 * client-supplied, so a caller can rotate it per request to dodge WIDGET_RATE_LIMIT
 * — this bounds aggregate spend per tenant regardless of how sessionKey is set.
 */
export const WIDGET_TENANT_RATE_LIMIT = { windowMs: 60_000, max: 120 } as const;

/** Max characters accepted from a single inbound customer message (post-sanitise cap). */
export const MAX_INBOUND_CHARS = 4000;

/** Bounds tool-calling rounds per inbound message — caps cost and prevents infinite loops. */
export const MAX_TOOL_ROUNDS = 3;

/** Idempotency window: identical (items+customer) orders within this many minutes are deduped. */
export const ORDER_DEDUPE_WINDOW_MINUTES = 5;

/** Abuse cap: max orders a single session may place within ORDER_CAP_WINDOW_MINUTES. */
export const MAX_ORDERS_PER_SESSION_WINDOW = 5;
export const ORDER_CAP_WINDOW_MINUTES = 60;

/** The private Supabase Storage bucket all inbound media is persisted to (docs/10 §2.4, migration 0016). */
export const ORDER_MEDIA_BUCKET = 'order-media';

/** Media download caps — enforced BEFORE buffering completes (docs/10 §7). */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 30 * 1024 * 1024; // Stage H cap (docs/10 §6.1)
export const MAX_VIDEO_SECONDS = 30; // Stage H cap (docs/10 §6.1) — advisory; MVP does not decode to verify.

/** MIME allow-list per attachment kind — anything else is rejected before buffering. */
export const MEDIA_ALLOWED_MIME: Record<'image' | 'audio' | 'video', string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  audio: ['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/amr', 'audio/wav', 'audio/aac'],
  video: ['video/mp4', 'video/3gpp', 'video/quicktime'],
};

/** Short-TTL signed URL lifetime for private media the model/dashboard may read (docs/10 §2.4). */
export const MEDIA_SIGNED_URL_TTL_SECONDS = 600;

/** Abuse cap: max media attachments a single session may have processed within the window (docs/10 §4.4/§8). */
export const MAX_MEDIA_PER_SESSION_WINDOW = 10;
export const MEDIA_CAP_WINDOW_MINUTES = 60;

/** Payment method priority when the customer's stated preference can't be resolved (docs/11 §3.3.1 A). */
export const PAYMENT_METHOD_PRIORITY = ['cod', 'manual_transfer', 'gateway'] as const;

/** How far back a session's orders are searched for an open manual-transfer proof target (docs/11 §3.3.1 B). */
export const PROOF_MATCH_WINDOW_HOURS = 72;

/** Stage N (docs/12 §5.5.1) — hard per-chunk token cap; oversize structured entries split on sentences. */
export const CHUNK_TOKEN_CAP = 400;

/** Stage N (docs/12 §5.5.5) — retrieval breadth and the dynamic-tail token budget for retrieved chunks. */
export const RETRIEVAL_TOP_K = 8;
export const RETRIEVED_CONTEXT_TOKEN_BUDGET = 2000;

/**
 * Free-plan daily cap on NEW distinct customer conversations per tenant (docs:
 * self-serve signup plan, Phase D). Resets at UTC midnight. Existing sessions
 * already counted for the day keep replying normally — only a brand-new
 * (tenant, platform, external user) session is gated.
 */
export const FREE_PLAN_DAILY_SESSION_CAP = 5;

/**
 * Stage U-cap (docs/18 §3, finding #7) — platform default for the free-plan
 * monthly master-key cost ceiling. `tenants.free_monthly_cap_usd` is a nullable
 * per-tenant override; null means "use this default", not "uncapped" — every
 * free-plan tenant is bounded. Scoped to `plan='free'` + non-BYOK turns only.
 */
export const DEFAULT_FREE_MONTHLY_CAP_USD = 5;

/**
 * CSAT gate (docs/16 §2, §4) — below this many order-review ratings in a range,
 * surface "not enough data yet" rather than a misleadingly precise percentage.
 */
export const MIN_CSAT_SAMPLE = 5;

/**
 * Stage T (docs/17 §4.3) — platform-level short retention on infra tables,
 * independent of any tenant's message_retention_days setting. Meta won't
 * redeliver a webhook after a few days, so idempotency only needs this horizon.
 */
export const WEBHOOK_EVENTS_RETENTION_DAYS = 30;
