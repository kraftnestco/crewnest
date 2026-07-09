/**
 * Single source of truth for tunable constants. No magic numbers in services.
 * See docs/06-INTEGRATIONS.md §5.
 */

/** Meta Graph API base (version comes from env.META_GRAPH_VERSION at call sites). */
export const META_GRAPH_BASE = 'https://graph.facebook.com';

/** Default LLM provider/model when a tenant has not overridden them. */
export const DEFAULT_LLM_PROVIDER = 'openai';
export const DEFAULT_LLM_MODEL = 'gpt-4o-mini';

/** Short-term memory: how many prior messages to load, and the dynamic-tail token budget. */
export const MEMORY_WINDOW_MESSAGES = 16;
export const MEMORY_TOKEN_BUDGET = 4000;

/**
 * Catalogue stuffing threshold (approx tokens). Above this, switch promptBuilder
 * to retrieval mode (pgvector) — Phase 3. Below, stuff into the cached prefix.
 */
export const CATALOG_STUFF_TOKEN_LIMIT = 40_000;

/** The control token the assistant emits to request human takeover. */
export const HUMAN_HANDOFF_TOKEN = '[HUMAN_HANDOFF]';

/** Website widget rate limiting. */
export const WIDGET_RATE_LIMIT = { windowMs: 60_000, max: 20 } as const;

/** Max characters accepted from a single inbound customer message (post-sanitise cap). */
export const MAX_INBOUND_CHARS = 4000;
