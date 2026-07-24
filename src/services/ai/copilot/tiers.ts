/**
 * Business Copilot — access tiers & patch validation (docs/19 O5).
 *
 * The single source of truth for WHAT the copilot is allowed to change. The
 * copilot LLM never writes to the database; it only proposes a structured
 * `CopilotPatch`, and `applyCopilotPatchAction` commits it. This module is the
 * hard boundary between the two: `copilotPatchSchema` (a strict zod schema) both
 * types the patch and rejects any key that is not on the allowlist, so a
 * hand-forged patch that tries to set an off-limits column (e.g. `llm_model`,
 * a `*_secret_id`, `plan`, `is_active`) is refused before any write is attempted.
 *
 * Tiers (see docs/19 O5):
 * - EDITABLE      — persona, catalogue, knowledge, hours+closures, basics, custom
 *                   orders, media/voice. Proposed → one-tap Apply.
 * - MONEY         — payment settings. Same Apply, but the UI flags a money change.
 * - OFF-LIMITS    — model/provider, all secret/vault refs, billing/plan/caps,
 *                   account on/off, channel wiring, retention. NOT in the schema
 *                   at all, so they can never appear in a patch. There is
 *                   deliberately no tool and no allowlist entry for them.
 *
 * NOT `server-only`: this is shared validation. The client panel imports the
 * `CopilotPatch` type and `MONEY_FIELDS` to render the preview + money banner.
 */
import { z } from 'zod';
import type { CopilotAction } from './actions';

const faqEntrySchema = z.object({ q: z.string(), a: z.string() });

/** Mirrors `KnowledgeBaseState` (intake-shared). Unknown keys are stripped. */
const knowledgeBaseSchema = z.object({
  faq: z.array(faqEntrySchema).optional(),
  delivery: z.string().optional(),
  returns: z.string().optional(),
  location: z.string().optional(),
  note: z.string().optional(),
});

const hourRowSchema = z.object({
  // Free string (matches the stored business_hours JSON and intake-shared HourRow);
  // the set_hours tool constrains the model to the seven day tokens on input.
  day: z.string(),
  open: z.string(),
  close: z.string(),
});

/**
 * Holiday/vacation closure — rides inside the existing `business_hours` JSONB, so
 * no migration. `from`/`to` are inclusive ISO calendar dates (YYYY-MM-DD) in the
 * tenant's timezone; `message` is the customer-facing "we're back on…" note.
 */
const closureSchema = z.object({
  from: z.string(),
  to: z.string(),
  message: z.string().optional(),
});

const businessHoursSchema = z.object({
  week: z.array(hourRowSchema).optional(),
  note: z.string().optional(),
  closures: z.array(closureSchema).optional(),
});

/**
 * The strict allowlist. `.strict()` makes zod REJECT any unknown key — this is
 * the defense-in-depth that stops a forged patch from ever naming an off-limits
 * column. Every field here is snake_case to match the `tenants` columns the apply
 * action writes directly. `catalog_data` is intentionally absent: the model
 * proposes `catalog_freeform_text` and the apply action derives `catalog_data`
 * server-side (via parseCatalogueFreeform) — the model never writes raw JSON.
 */
export const copilotPatchSchema = z
  .object({
    // ── Editable ──────────────────────────────────────────────
    system_prompt: z.string(),
    catalog_freeform_text: z.string(),
    knowledge_base: knowledgeBaseSchema,
    business_hours: businessHoursSchema,
    timezone: z.string().nullable(),
    business_type: z.enum(['product', 'service']),
    booking_link: z.string().nullable(),
    custom_orders_enabled: z.boolean(),
    custom_orders_require_approval: z.boolean(),
    custom_order_instructions: z.string().nullable(),
    media_handling: z.enum(['match_catalogue', 'accept_any', 'reject']),
    voice_handling: z.enum(['ai_autonomous', 'human_review']),
    // ── Money (flagged in the preview) ────────────────────────
    payments_enabled: z.boolean(),
    payment_methods: z.array(z.enum(['cod', 'manual_transfer', 'gateway'])),
    payment_instructions: z.string().nullable(),
    default_currency: z.string(),
    prepaid_required: z.boolean(),
  })
  .partial()
  .strict();

export type CopilotPatch = z.infer<typeof copilotPatchSchema>;

/** Every column a patch may touch (the allowlist keys). */
export const ALLOWED_FIELDS = Object.keys(copilotPatchSchema.shape) as (keyof CopilotPatch)[];

/** Payment fields — a change to any of these is a "money change" the UI flags. */
export const MONEY_FIELDS = [
  'payments_enabled',
  'payment_methods',
  'payment_instructions',
  'default_currency',
  'prepaid_required',
] as const satisfies readonly (keyof CopilotPatch)[];

const MONEY_FIELD_SET: ReadonlySet<string> = new Set(MONEY_FIELDS);

/** True when the patch changes anything about how customers pay. */
export function patchHasMoneyChange(patch: CopilotPatch): boolean {
  return Object.keys(patch).some((k) => MONEY_FIELD_SET.has(k));
}

/** True when the patch stages no actual change. */
export function patchIsEmpty(patch: CopilotPatch): boolean {
  return Object.keys(patch).length === 0;
}

/** One turn of the copilot transcript sent from the client. */
export interface CopilotMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Result of `copilotTurnAction` — the reply + the staged (not yet applied) patch/action. */
export interface CopilotTurnState {
  reply: string;
  patch: CopilotPatch;
  action?: CopilotAction;
  hasMoneyChange: boolean;
  error: string | null;
}

/** Result of `applyCopilotPatchAction`. */
export interface ApplyPatchState {
  success: boolean;
  error: string | null;
}

export type ValidatePatchResult =
  | { ok: true; patch: CopilotPatch }
  | { ok: false; error: string };

/**
 * Validates a patch received from the client before any write. Rejects unknown
 * keys (off-limits columns) and malformed values. This runs in the apply action
 * on a payload that round-tripped through the browser, so it is the security
 * boundary, not a formality.
 */
export function validatePatch(raw: unknown): ValidatePatchResult {
  const parsed = copilotPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'That change was not valid.' };
  }
  return { ok: true, patch: parsed.data };
}
