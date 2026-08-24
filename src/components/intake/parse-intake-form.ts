import type { Json } from '@/types/database';

/**
 * Pure parser for the Stage-E intake wizard's `FormData` output (docs/10 §3.1).
 *
 * Shared by the dashboard's `updateIntakeAction` (edit an existing tenant) and
 * the self-serve onboarding's `provisionFromIntakeAction` (create a new tenant),
 * so the two can never drift on an allow-list — a private duplicate in either
 * place silently changed what a saved field accepted (the codebase's standing
 * rule against duplicated allow-lists, same reasoning as PAYWALL_PLANS).
 *
 * Server-safe: no React, no Supabase, no LLM. The async catalog-derivation
 * (`parseCatalogueFreeform`) is deliberately NOT here — it needs a tenant row
 * and is the caller's concern, not the parser's.
 */

const MEDIA_HANDLING_VALUES = ['match_catalogue', 'accept_any', 'reject'] as const;
const VOICE_HANDLING_VALUES = ['ai_autonomous', 'human_review'] as const;
const BUSINESS_TYPE_VALUES = ['product', 'service'] as const;
/** App-level allow-list (docs/11 §2.3) — payment_method(s) are plain text/text[], not a DB enum. */
const PAYMENT_METHOD_VALUES = ['cod', 'manual_transfer', 'gateway'] as const;

/**
 * The narrow slice of `FormData` the parser reads. `FormData` itself satisfies
 * this, and so does a plain-object adapter — handy when a caller has already
 * collected fields into an object. Accepting the interface (not the concrete
 * `FormData`) keeps the parser usable from both without an awkward conversion.
 */
export interface IntakeFormLike {
  get(name: string): FormDataEntryValue | null;
  getAll(name: string): FormDataEntryValue[];
}

/**
 * Adapts a plain record (the shape that safely crosses the server-action wire
 * — `FormData` itself isn't a guaranteed-serializable argument) into the
 * `IntakeFormLike` the parser reads. Repeated keys (e.g. `payment_methods`)
 * are arrays; single keys are strings. The onboarding client builds the
 * record from the wizard's `FormData` and passes it to the provision action.
 */
export function recordToIntakeForm(record: Record<string, string | string[]>): IntakeFormLike {
  return {
    get(name) {
      const v = record[name];
      if (v == null) return null;
      return Array.isArray(v) ? (v[0] ?? null) : v;
    },
    getAll(name) {
      const v = record[name];
      if (v == null) return [];
      return Array.isArray(v) ? v : [v];
    },
  };
}

export interface ParsedIntake {
  systemPrompt: string;
  customOrderInstructions: string | null;
  mediaHandling: string;
  voiceHandling: string;
  businessType: string;
  bookingLink: string | null;
  bookingEnabled: boolean;
  bookingMode: 'calcom' | 'own_link' | null;
  bookingOwnLink: string | null;
  bookingDurationMinutes: number;
  bookingLeadTimeMinutes: number;
  bookingMaxDaysAhead: number;
  customOrdersEnabled: boolean;
  customOrdersRequireApproval: boolean;
  knowledgeBase: Json | null;
  businessHours: Json | null;
  timezone: string | null;
  paymentsEnabled: boolean;
  paymentMethods: string[];
  paymentInstructions: string | null;
  defaultCurrency: string;
  prepaidRequired: boolean;
  /** Client path only — the owner's freeform catalogue text. Null when blank. */
  catalogFreeformText: string | null;
  /** Admin path only — parsed `catalog_data` JSON. Null when absent or blank. */
  catalogDataAdmin: Json | null;
}

/** A parse failure the caller surfaces verbatim to the user. */
export type IntakeParseError = { error: string };

/** Clamps a hand-edited int so a form can never produce a 0-minute or 10-year window. */
function clampInt(raw: FormDataEntryValue | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/**
 * @returns the parsed fields, or `{ error }` for a malformed payload (bad
 * `catalog_data` JSON, bad `knowledge_base_json`, bad `business_hours_json`).
 * The caller decides which errors are fatal — same strings as before so the
 * dashboard's surfaced messages are unchanged.
 */
export function parseIntakeFormData(
  form: IntakeFormLike,
  opts: { isPlatformAdmin: boolean },
): ParsedIntake | IntakeParseError {
  const systemPrompt = String(form.get('system_prompt') ?? '');
  const customOrderInstructions = String(form.get('custom_order_instructions') ?? '').trim() || null;
  const mediaHandlingRaw = String(form.get('media_handling') ?? 'match_catalogue');
  const mediaHandling = (MEDIA_HANDLING_VALUES as readonly string[]).includes(mediaHandlingRaw)
    ? mediaHandlingRaw
    : 'match_catalogue';
  const voiceHandlingRaw = String(form.get('voice_handling') ?? 'human_review');
  const voiceHandling = (VOICE_HANDLING_VALUES as readonly string[]).includes(voiceHandlingRaw)
    ? voiceHandlingRaw
    : 'human_review';
  const businessTypeRaw = String(form.get('business_type') ?? 'product');
  const businessType = (BUSINESS_TYPE_VALUES as readonly string[]).includes(businessTypeRaw)
    ? businessTypeRaw
    : 'product';
  const bookingLink = String(form.get('booking_link') ?? '').trim() || null;

  // Appointment booking (docs/24). Force-disabled for a product business: the
  // tools are gated on businessType === 'service' in the tool registry, so an
  // enabled flag on a product tenant would be a setting that silently does
  // nothing. Enforced here, server-side, not only in the form.
  const bookingEnabled = businessType === 'service' && form.get('booking_enabled') === 'on';
  const bookingModeRaw = String(form.get('booking_mode') ?? '').trim();
  const bookingMode: 'calcom' | 'own_link' | null =
    bookingModeRaw === 'own_link' || bookingModeRaw === 'calcom' ? bookingModeRaw : null;
  const bookingOwnLink = String(form.get('booking_own_link') ?? '').trim() || null;
  const bookingDurationMinutes = clampInt(form.get('booking_duration_minutes'), 30, 5, 480);
  const bookingLeadTimeMinutes = clampInt(form.get('booking_lead_time_minutes'), 120, 0, 10080);
  const bookingMaxDaysAhead = clampInt(form.get('booking_max_days_ahead'), 30, 1, 365);
  const customOrdersEnabled = form.get('custom_orders_enabled') === 'on';
  const customOrdersRequireApproval = form.get('custom_orders_require_approval') === 'on';
  const knowledgeBaseRaw = String(form.get('knowledge_base_json') ?? '').trim();
  const businessHoursRaw = String(form.get('business_hours_json') ?? '').trim();
  const timezone = String(form.get('timezone') ?? '').trim() || null;
  const paymentsEnabled = form.get('payments_enabled') === 'on';
  const paymentMethodsRaw = form.getAll('payment_methods').map(String);
  const paymentMethods = paymentMethodsRaw.filter((m) =>
    (PAYMENT_METHOD_VALUES as readonly string[]).includes(m),
  );
  const paymentInstructions = String(form.get('payment_instructions') ?? '').trim() || null;
  const defaultCurrency = String(form.get('default_currency') ?? '').trim() || 'PKR';
  const prepaidRequired = form.get('prepaid_required') === 'on';

  // Admins edit catalog_data as raw JSON directly; clients describe their
  // catalogue in plain language and the caller derives the JSON the AI reads
  // (docs/13 §9 — clients are non-technical, JSON stays admin-only).
  let catalogDataAdmin: Json | null = null;
  let catalogFreeformText: string | null = null;
  if (opts.isPlatformAdmin) {
    const catalogRaw = String(form.get('catalog_data') ?? '').trim();
    if (catalogRaw) {
      try {
        catalogDataAdmin = JSON.parse(catalogRaw) as Json;
      } catch {
        return { error: 'Catalogue must be valid JSON.' };
      }
    }
  } else {
    catalogFreeformText = String(form.get('catalog_freeform') ?? '').trim() || null;
  }

  let knowledgeBase: Json | null = null;
  if (knowledgeBaseRaw) {
    try {
      knowledgeBase = JSON.parse(knowledgeBaseRaw) as Json;
    } catch {
      return { error: 'Knowledge base was malformed. Please retry.' };
    }
  }

  let businessHours: Json | null = null;
  if (businessHoursRaw) {
    try {
      businessHours = JSON.parse(businessHoursRaw) as Json;
    } catch {
      return { error: 'Business hours were malformed. Please retry.' };
    }
  }

  return {
    systemPrompt,
    customOrderInstructions,
    mediaHandling,
    voiceHandling,
    businessType,
    bookingLink,
    bookingEnabled,
    bookingMode,
    bookingOwnLink,
    bookingDurationMinutes,
    bookingLeadTimeMinutes,
    bookingMaxDaysAhead,
    customOrdersEnabled,
    customOrdersRequireApproval,
    knowledgeBase,
    businessHours,
    timezone,
    paymentsEnabled,
    paymentMethods,
    paymentInstructions,
    defaultCurrency,
    prepaidRequired,
    catalogFreeformText,
    catalogDataAdmin,
  };
}
