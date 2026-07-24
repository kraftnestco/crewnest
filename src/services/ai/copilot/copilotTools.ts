import 'server-only';
import { z } from 'zod';
import type { LlmToolCall, LlmToolDef } from '@/services/ai/provider';
import type { BusinessType, MediaHandling, PaymentMethod, Tenant, VoiceHandling } from '@/types/domain';
import type { Closure } from '@/services/hours';
import type { CopilotPatch } from './tiers';
import { MEMBER_ROLE_VALUES } from '@/services/teamMembers';
import type { CopilotAction } from './actions';
import { createServiceClient } from '@/lib/supabase/service';
import {
  type FaqEntry,
  type HourRow,
  type KnowledgeBaseState,
  parseBusinessHours,
  parseKnowledgeBase,
} from '@/components/intake/intake-shared';
import { composeSystemPrompt } from '@/services/ai/promptArchitect';
import { magicImportFromUrl } from '@/services/ai/magicImport';
import { log } from '@/lib/log';

/**
 * Business Copilot tools (docs/19 O5). These mirror `services/tools/registry.ts`
 * in shape (`{ def, argsSchema, execute }`) but are DELIBERATELY side-effect-free:
 * each tool only STAGES a slice of change into an in-memory `CopilotDraft` and
 * returns a one-line confirmation the model can read back. Nothing here writes to
 * the database — the LLM proposes, `applyCopilotPatchAction` (the deterministic,
 * tier-checked applier) commits. The set of tools IS the write surface: there is
 * no tool for any off-limits field (model/provider, secrets, plan, account
 * on/off, channel wiring), so the model cannot even name them.
 *
 * The draft keeps a mutable working `snapshot` (seeded from the tenant's current
 * profile) so multiple tool calls in one turn compose correctly — e.g. set_hours
 * then set_holiday_closure both operate on the same evolving business_hours — and
 * so revisions merge onto real current data instead of wiping it.
 */

/* ----------------------------------------------------------------- draft model */

type TenantForCopilot = Pick<Tenant, 'id' | 'businessName' | 'openaiKeySecretId' | 'llmProvider' | 'llmModel'>;

interface WorkingHours {
  week: HourRow[]; // always the 7 days (empty open/close = closed), per parseBusinessHours
  note: string;
  closures: Closure[];
}

export interface CopilotSnapshot {
  systemPrompt: string;
  catalogueText: string;
  knowledge: KnowledgeBaseState;
  hours: WorkingHours;
  timezone: string | null;
  businessType: BusinessType;
  bookingLink: string | null;
  customOrdersEnabled: boolean;
  customOrdersRequireApproval: boolean;
  customOrderInstructions: string | null;
  mediaHandling: MediaHandling;
  voiceHandling: VoiceHandling;
  paymentsEnabled: boolean;
  paymentMethods: PaymentMethod[];
  paymentInstructions: string | null;
  defaultCurrency: string;
  prepaidRequired: boolean;
}

export interface CopilotDraft {
  tenant: TenantForCopilot;
  snapshot: CopilotSnapshot;
  patch: CopilotPatch;
  /** Staged imperative operation (invite/inventory) — separate from `patch` since it calls an existing action, not a column write. Only one action may be staged per turn. */
  action?: CopilotAction;
  warnings: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Best-effort readable rendering of stored catalog_data JSON when no freeform text exists. */
function catalogDataToText(catalogData: unknown): string {
  if (!Array.isArray(catalogData)) return '';
  return catalogData
    .filter(isRecord)
    .map((item) => {
      const name = typeof item.name === 'string' ? item.name : '';
      const price = typeof item.price === 'string' ? item.price : '';
      const description = typeof item.description === 'string' ? item.description : '';
      return [name, price, description].filter(Boolean).join(' — ');
    })
    .filter(Boolean)
    .join('\n');
}

function parseClosures(raw: unknown): Closure[] {
  if (!isRecord(raw) || !Array.isArray(raw.closures)) return [];
  return raw.closures.filter(isRecord).flatMap((c) => {
    if (typeof c.from !== 'string' || typeof c.to !== 'string') return [];
    return [{ from: c.from, to: c.to, ...(typeof c.message === 'string' ? { message: c.message } : {}) }];
  });
}

/**
 * Seed a draft from the tenant's CURRENT profile. `catalogFreeformText` is passed
 * in because the domain Tenant type doesn't carry it; falls back to a readable
 * rendering of catalog_data so the model can still revise an admin-JSON catalogue.
 */
export function buildCopilotDraft(
  tenant: Tenant,
  catalogFreeformText: string | null,
): CopilotDraft {
  const parsedHours = parseBusinessHours(tenant.businessHours);
  return {
    tenant: {
      id: tenant.id,
      businessName: tenant.businessName,
      openaiKeySecretId: tenant.openaiKeySecretId,
      llmProvider: tenant.llmProvider,
      llmModel: tenant.llmModel,
    },
    snapshot: {
      systemPrompt: tenant.systemPrompt,
      catalogueText: (catalogFreeformText ?? '').trim() || catalogDataToText(tenant.catalogData),
      knowledge: parseKnowledgeBase(tenant.knowledgeBase),
      hours: { week: parsedHours.week, note: parsedHours.note, closures: parseClosures(tenant.businessHours) },
      timezone: tenant.timezone,
      businessType: tenant.businessType,
      bookingLink: tenant.bookingLink,
      customOrdersEnabled: tenant.customOrdersEnabled,
      customOrdersRequireApproval: tenant.customOrdersRequireApproval,
      customOrderInstructions: tenant.customOrderInstructions,
      mediaHandling: tenant.mediaHandling,
      voiceHandling: tenant.voiceHandling,
      paymentsEnabled: tenant.paymentsEnabled,
      paymentMethods: tenant.paymentMethods,
      paymentInstructions: tenant.paymentInstructions,
      defaultCurrency: tenant.defaultCurrency,
      prepaidRequired: tenant.prepaidRequired,
    },
    patch: {},
    warnings: [],
  };
}

/** A compact, human-readable summary of the current profile for the system prompt. */
export function describeSnapshot(s: CopilotSnapshot): string {
  const daysOpen = s.hours.week.filter((r) => r.open && r.close);
  const hoursLine = daysOpen.length
    ? daysOpen.map((r) => `${r.day} ${r.open}-${r.close}`).join(', ')
    : 'not set';
  const closuresLine = s.hours.closures.length
    ? s.hours.closures.map((c) => `${c.from}→${c.to}${c.message ? ` (${c.message})` : ''}`).join('; ')
    : 'none';
  const faqLine = s.knowledge.faq.length ? `${s.knowledge.faq.length} entries` : 'none';
  return [
    `Business type: ${s.businessType}`,
    `Timezone: ${s.timezone ?? 'not set'}`,
    `Weekly hours: ${hoursLine}`,
    `Holiday closures: ${closuresLine}`,
    `Booking link: ${s.bookingLink ?? 'none'}`,
    `Custom orders: ${s.customOrdersEnabled ? 'on' : 'off'}${s.customOrdersEnabled && s.customOrdersRequireApproval ? ' (needs approval)' : ''}`,
    `Media handling: ${s.mediaHandling}; Voice handling: ${s.voiceHandling}`,
    `Payments: ${s.paymentsEnabled ? 'on' : 'off'}; methods: ${s.paymentMethods.join(', ') || 'none'}; currency: ${s.defaultCurrency}; prepaid required: ${s.prepaidRequired ? 'yes' : 'no'}`,
    `Delivery: ${s.knowledge.delivery || 'not set'}`,
    `Returns: ${s.knowledge.returns || 'not set'}`,
    `Location: ${s.knowledge.location || 'not set'}`,
    `FAQ: ${faqLine}`,
    '',
    'Current catalogue (freeform):',
    s.catalogueText || '(empty)',
  ].join('\n');
}

/* ---------------------------------------------------------------------- helpers */

/** Empty string clears a nullable text field. */
function orNull(v: string | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  const t = v.trim();
  return t.length ? t : null;
}

/* ------------------------------------------------------------------------ tools */

export interface CopilotTool {
  def: LlmToolDef;
  argsSchema: z.ZodTypeAny;
  execute(args: unknown, draft: CopilotDraft): Promise<string>;
}

const updatePersonaTool: CopilotTool = {
  def: {
    name: 'update_persona',
    description:
      "Rewrite the assistant's persona/voice (the 'system prompt' that shapes how it talks to customers). " +
      'Use for requests like "sound more premium/formal", "be more playful", or "always greet in Urdu". ' +
      'You give guided fields; a specialist writes the final persona text. Never put prices, hours, or policies here.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        businessSummary: { type: 'string', description: 'One line on what the business does, if the owner restated it.' },
        tone: { type: 'string', description: "Desired voice, e.g. 'premium', 'friendly', 'playful', 'professional', or a phrase." },
        boundaries: { type: 'string', description: "Specific do's and don'ts the owner wants woven in." },
      },
    },
  },
  argsSchema: z.object({
    businessSummary: z.string().optional(),
    tone: z.string().optional(),
    boundaries: z.string().optional(),
  }),
  async execute(args, draft) {
    const a = args as { businessSummary?: string; tone?: string; boundaries?: string };
    const prompt = await composeSystemPrompt(draft.tenant, {
      businessName: draft.tenant.businessName,
      businessType: draft.snapshot.businessType,
      businessSummary: a.businessSummary,
      tone: a.tone,
      boundaries: a.boundaries,
      catalogueHint: draft.snapshot.catalogueText,
    });
    draft.snapshot.systemPrompt = prompt;
    draft.patch.system_prompt = prompt;
    return "Rewrote the assistant's persona to match the requested voice.";
  },
};

const reviseCatalogueTool: CopilotTool = {
  def: {
    name: 'revise_catalogue',
    description:
      'Replace the catalogue text with a full revised version. To ADD, REMOVE, or CHANGE items or prices, take the ' +
      'current catalogue shown to you, apply the edit, and pass back the ENTIRE updated catalogue as plain lines ' +
      "(e.g. 'Bridal makeup - Rs 15000'). Never pass only the new line — that would wipe the existing items.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['catalogue_text'],
      properties: {
        catalogue_text: { type: 'string', description: 'The complete revised catalogue, one item per line, prices as written.' },
      },
    },
  },
  argsSchema: z.object({ catalogue_text: z.string().min(1) }),
  async execute(args, draft) {
    const a = args as { catalogue_text: string };
    draft.snapshot.catalogueText = a.catalogue_text.trim();
    draft.patch.catalog_freeform_text = draft.snapshot.catalogueText;
    return 'Staged the revised catalogue.';
  },
};

const updateKnowledgeTool: CopilotTool = {
  def: {
    name: 'update_knowledge',
    description:
      'Update the business facts the assistant answers from: delivery info, returns/refund policy, location, a general ' +
      'note, and the FAQ list. Only pass the fields you are changing. For faq, pass the COMPLETE list you want (include ' +
      'existing entries to keep) — it replaces the current FAQ.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        delivery: { type: 'string', description: 'Delivery/shipping info.' },
        returns: { type: 'string', description: 'Returns/refund/exchange policy.' },
        location: { type: 'string', description: 'Physical address or service area.' },
        note: { type: 'string', description: 'Any other short useful fact (languages, lead times, holiday note…).' },
        faq: {
          type: 'array',
          description: 'Complete FAQ list to store (replaces existing).',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['q', 'a'],
            properties: { q: { type: 'string' }, a: { type: 'string' } },
          },
        },
      },
    },
  },
  argsSchema: z.object({
    delivery: z.string().optional(),
    returns: z.string().optional(),
    location: z.string().optional(),
    note: z.string().optional(),
    faq: z.array(z.object({ q: z.string(), a: z.string() })).optional(),
  }),
  async execute(args, draft) {
    const a = args as { delivery?: string; returns?: string; location?: string; note?: string; faq?: FaqEntry[] };
    const kb = draft.snapshot.knowledge;
    if (a.delivery !== undefined) kb.delivery = a.delivery.trim();
    if (a.returns !== undefined) kb.returns = a.returns.trim();
    if (a.location !== undefined) kb.location = a.location.trim();
    if (a.note !== undefined) kb.note = a.note.trim();
    if (a.faq !== undefined) kb.faq = a.faq.filter((e) => e.q.trim() && e.a.trim());
    draft.patch.knowledge_base = kb;
    return 'Updated the business knowledge/FAQ.';
  },
};

const setHoursTool: CopilotTool = {
  def: {
    name: 'set_hours',
    description:
      'Set the weekly opening hours. Pass the days you are changing as {day, open, close} using 24h HH:MM; leave open/close ' +
      'empty ("") for a closed day. Include the timezone (IANA, e.g. "Asia/Karachi") if it is not already set. This does ' +
      'NOT touch holiday closures — use set_holiday_closure for a one-off break.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['week'],
      properties: {
        week: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['day', 'open', 'close'],
            properties: {
              day: { type: 'string', enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] },
              open: { type: 'string', description: '24h HH:MM, or "" if closed that day.' },
              close: { type: 'string', description: '24h HH:MM, or "" if closed that day.' },
            },
          },
        },
        note: { type: 'string', description: 'Optional note, e.g. "Closed 1-2pm for lunch".' },
        timezone: { type: 'string', description: 'IANA timezone, e.g. "Asia/Karachi".' },
      },
    },
  },
  argsSchema: z.object({
    week: z.array(
      z.object({
        day: z.enum(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']),
        open: z.string(),
        close: z.string(),
      }),
    ),
    note: z.string().optional(),
    timezone: z.string().optional(),
  }),
  async execute(args, draft) {
    const a = args as { week: HourRow[]; note?: string; timezone?: string };
    const byDay = new Map(draft.snapshot.hours.week.map((r) => [r.day, r]));
    for (const row of a.week) byDay.set(row.day, { day: row.day, open: row.open.trim(), close: row.close.trim() });
    draft.snapshot.hours.week = Array.from(byDay.values());
    if (a.note !== undefined) draft.snapshot.hours.note = a.note.trim();
    if (a.timezone !== undefined && a.timezone.trim()) {
      draft.snapshot.timezone = a.timezone.trim();
      draft.patch.timezone = draft.snapshot.timezone;
    }
    draft.patch.business_hours = draft.snapshot.hours;
    return 'Updated the weekly opening hours.';
  },
};

const setHolidayClosureTool: CopilotTool = {
  def: {
    name: 'set_holiday_closure',
    description:
      'Add a one-off holiday/vacation closure so the assistant tells customers the business is closed on those dates. ' +
      'Dates are inclusive calendar dates as YYYY-MM-DD. Always include a short customer-facing message ' +
      '(e.g. "Closed for Eid 24–26 Dec, back on the 27th").',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['from', 'to', 'message'],
      properties: {
        from: { type: 'string', description: 'First closed day, YYYY-MM-DD.' },
        to: { type: 'string', description: 'Last closed day, YYYY-MM-DD (same as from for a single day).' },
        message: { type: 'string', description: 'Short away message customers will hear.' },
      },
    },
  },
  argsSchema: z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must be YYYY-MM-DD.'),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must be YYYY-MM-DD.'),
    message: z.string().min(1),
  }),
  async execute(args, draft) {
    const a = args as { from: string; to: string; message: string };
    const closures = draft.snapshot.hours.closures.filter((c) => c.from !== a.from);
    closures.push({ from: a.from, to: a.to, message: a.message.trim() });
    draft.snapshot.hours.closures = closures;
    draft.patch.business_hours = draft.snapshot.hours;
    return `Staged a holiday closure ${a.from} to ${a.to}.`;
  },
};

const clearHolidayClosureTool: CopilotTool = {
  def: {
    name: 'clear_holiday_closure',
    description: 'Remove all holiday/vacation closures — the business returns to its normal weekly hours.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
  argsSchema: z.object({}),
  async execute(_args, draft) {
    draft.snapshot.hours.closures = [];
    draft.patch.business_hours = draft.snapshot.hours;
    return 'Cleared all holiday closures.';
  },
};

const setBusinessBasicsTool: CopilotTool = {
  def: {
    name: 'set_business_basics',
    description:
      'Set high-level basics: business_type ("product" for a shop selling items, "service" for bookings/quotes), a ' +
      'booking_link for service businesses, and/or the timezone. Only pass what is changing. Pass booking_link as "" to remove it.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        business_type: { type: 'string', enum: ['product', 'service'] },
        booking_link: { type: 'string', description: 'A URL customers use to book, or "" to remove.' },
        timezone: { type: 'string', description: 'IANA timezone, e.g. "Asia/Karachi".' },
      },
    },
  },
  argsSchema: z.object({
    business_type: z.enum(['product', 'service']).optional(),
    booking_link: z.string().optional(),
    timezone: z.string().optional(),
  }),
  async execute(args, draft) {
    const a = args as { business_type?: BusinessType; booking_link?: string; timezone?: string };
    if (a.business_type !== undefined) {
      draft.snapshot.businessType = a.business_type;
      draft.patch.business_type = a.business_type;
    }
    if (a.booking_link !== undefined) {
      draft.snapshot.bookingLink = orNull(a.booking_link) ?? null;
      draft.patch.booking_link = draft.snapshot.bookingLink;
    }
    if (a.timezone !== undefined && a.timezone.trim()) {
      draft.snapshot.timezone = a.timezone.trim();
      draft.patch.timezone = draft.snapshot.timezone;
    }
    return 'Updated the business basics.';
  },
};

const setCustomOrdersTool: CopilotTool = {
  def: {
    name: 'set_custom_orders',
    description:
      'Configure custom/made-to-order handling: turn it on/off, whether each custom order needs your approval before ' +
      'confirming, and instructions for how the assistant should gather custom requests. Only pass what is changing.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        custom_orders_enabled: { type: 'boolean' },
        custom_orders_require_approval: { type: 'boolean' },
        custom_order_instructions: { type: 'string', description: 'How to handle custom requests, or "" to clear.' },
      },
    },
  },
  argsSchema: z.object({
    custom_orders_enabled: z.boolean().optional(),
    custom_orders_require_approval: z.boolean().optional(),
    custom_order_instructions: z.string().optional(),
  }),
  async execute(args, draft) {
    const a = args as {
      custom_orders_enabled?: boolean;
      custom_orders_require_approval?: boolean;
      custom_order_instructions?: string;
    };
    if (a.custom_orders_enabled !== undefined) {
      draft.snapshot.customOrdersEnabled = a.custom_orders_enabled;
      draft.patch.custom_orders_enabled = a.custom_orders_enabled;
    }
    if (a.custom_orders_require_approval !== undefined) {
      draft.snapshot.customOrdersRequireApproval = a.custom_orders_require_approval;
      draft.patch.custom_orders_require_approval = a.custom_orders_require_approval;
    }
    if (a.custom_order_instructions !== undefined) {
      draft.snapshot.customOrderInstructions = orNull(a.custom_order_instructions) ?? null;
      draft.patch.custom_order_instructions = draft.snapshot.customOrderInstructions;
    }
    return 'Updated custom-order settings.';
  },
};

const setMediaVoiceTool: CopilotTool = {
  def: {
    name: 'set_media_voice',
    description:
      'Set how the assistant treats customer-sent photos (media_handling: "match_catalogue" | "accept_any" | "reject") ' +
      'and voice notes (voice_handling: "ai_autonomous" answers directly | "human_review" holds for a teammate). Only pass what changes.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        media_handling: { type: 'string', enum: ['match_catalogue', 'accept_any', 'reject'] },
        voice_handling: { type: 'string', enum: ['ai_autonomous', 'human_review'] },
      },
    },
  },
  argsSchema: z.object({
    media_handling: z.enum(['match_catalogue', 'accept_any', 'reject']).optional(),
    voice_handling: z.enum(['ai_autonomous', 'human_review']).optional(),
  }),
  async execute(args, draft) {
    const a = args as { media_handling?: MediaHandling; voice_handling?: VoiceHandling };
    if (a.media_handling !== undefined) {
      draft.snapshot.mediaHandling = a.media_handling;
      draft.patch.media_handling = a.media_handling;
    }
    if (a.voice_handling !== undefined) {
      draft.snapshot.voiceHandling = a.voice_handling;
      draft.patch.voice_handling = a.voice_handling;
    }
    return 'Updated media/voice handling.';
  },
};

const configurePaymentsTool: CopilotTool = {
  def: {
    name: 'configure_payments',
    description:
      'Change how customers pay: turn payments on/off, which methods are accepted (cod = cash on delivery, ' +
      'manual_transfer = bank/wallet transfer with a receipt), the transfer/account instructions, the default currency ' +
      '(e.g. "PKR"), and whether prepayment is required. This is a MONEY change — the owner will see it clearly flagged before applying.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        payments_enabled: { type: 'boolean' },
        payment_methods: { type: 'array', items: { type: 'string', enum: ['cod', 'manual_transfer', 'gateway'] } },
        payment_instructions: { type: 'string', description: 'Account/transfer details customers need, or "" to clear.' },
        default_currency: { type: 'string', description: 'Currency code, e.g. "PKR".' },
        prepaid_required: { type: 'boolean' },
      },
    },
  },
  argsSchema: z.object({
    payments_enabled: z.boolean().optional(),
    payment_methods: z.array(z.enum(['cod', 'manual_transfer', 'gateway'])).optional(),
    payment_instructions: z.string().optional(),
    default_currency: z.string().optional(),
    prepaid_required: z.boolean().optional(),
  }),
  async execute(args, draft) {
    const a = args as {
      payments_enabled?: boolean;
      payment_methods?: PaymentMethod[];
      payment_instructions?: string;
      default_currency?: string;
      prepaid_required?: boolean;
    };
    if (a.payments_enabled !== undefined) {
      draft.snapshot.paymentsEnabled = a.payments_enabled;
      draft.patch.payments_enabled = a.payments_enabled;
    }
    if (a.payment_methods !== undefined) {
      draft.snapshot.paymentMethods = a.payment_methods;
      draft.patch.payment_methods = a.payment_methods;
    }
    if (a.payment_instructions !== undefined) {
      draft.snapshot.paymentInstructions = orNull(a.payment_instructions) ?? null;
      draft.patch.payment_instructions = draft.snapshot.paymentInstructions;
    }
    if (a.default_currency !== undefined && a.default_currency.trim()) {
      draft.snapshot.defaultCurrency = a.default_currency.trim().toUpperCase();
      draft.patch.default_currency = draft.snapshot.defaultCurrency;
    }
    if (a.prepaid_required !== undefined) {
      draft.snapshot.prepaidRequired = a.prepaid_required;
      draft.patch.prepaid_required = a.prepaid_required;
    }
    return 'Staged the payment settings (money change — flagged for the owner).';
  },
};

const importFromUrlTool: CopilotTool = {
  def: {
    name: 'import_from_url',
    description:
      "Read the owner's website, Facebook, or Instagram page and pull in a draft persona, catalogue, and business facts. " +
      'Use when the owner shares a link and asks you to set things up or refresh from it. The owner reviews everything before applying.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: { url: { type: 'string', description: 'A public http(s) link to the business website or social page.' } },
    },
  },
  argsSchema: z.object({ url: z.string().min(1) }),
  async execute(args, draft) {
    const a = args as { url: string };
    const { fields, summary } = await magicImportFromUrl(draft.tenant, a.url);
    if (fields.business_type === 'product' || fields.business_type === 'service') {
      draft.snapshot.businessType = fields.business_type;
      draft.patch.business_type = fields.business_type;
    }
    if (fields.system_prompt) {
      draft.snapshot.systemPrompt = fields.system_prompt;
      draft.patch.system_prompt = fields.system_prompt;
    }
    if (fields.catalog_freeform_text) {
      draft.snapshot.catalogueText = fields.catalog_freeform_text;
      draft.patch.catalog_freeform_text = fields.catalog_freeform_text;
    }
    if (fields.knowledge_base !== undefined) {
      draft.snapshot.knowledge = parseKnowledgeBase(fields.knowledge_base);
      draft.patch.knowledge_base = draft.snapshot.knowledge;
    }
    return summary;
  },
};

const inviteTeamMemberTool: CopilotTool = {
  def: {
    name: 'invite_team_member',
    description:
      'Invite a new teammate to help run this business by email. Role is "tenant_admin" (full access, same as ' +
      'the owner) or "tenant_agent" (works the inbox/orders, no billing/team/settings access). This PROPOSES the ' +
      'invite — nothing is sent until the owner reviews and approves it.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['email', 'role'],
      properties: {
        email: { type: 'string', description: "The teammate's email address." },
        role: {
          type: 'string',
          enum: [...MEMBER_ROLE_VALUES],
          description: '"tenant_admin" for full access, "tenant_agent" for limited access.',
        },
      },
    },
  },
  argsSchema: z.object({
    email: z.string().trim().email(),
    role: z.enum(MEMBER_ROLE_VALUES),
  }),
  async execute(args, draft) {
    const a = args as { email: string; role: (typeof MEMBER_ROLE_VALUES)[number] };
    draft.action = { type: 'invite_team_member', email: a.email.trim(), role: a.role };
    return `Staged an invite for ${a.email} as ${a.role === 'tenant_admin' ? 'an admin' : 'an agent'}.`;
  },
};

const setInventoryStockTool: CopilotTool = {
  def: {
    name: 'set_inventory_stock',
    description:
      'Set the exact stock count for one catalogue item by name, e.g. "set Bridal Lehenga stock to 5". Use ' +
      'restock_inventory instead when the owner describes an ADDITION rather than the exact new total. This ' +
      'PROPOSES the change — nothing updates until the owner approves it.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['item_name', 'stock'],
      properties: {
        item_name: { type: 'string', description: 'The catalogue item name, as it appears in the catalogue.' },
        stock: { type: 'integer', minimum: 0, description: 'The exact new stock count.' },
      },
    },
  },
  argsSchema: z.object({
    item_name: z.string().trim().min(1),
    stock: z.number().int().min(0),
  }),
  async execute(args, draft) {
    const a = args as { item_name: string; stock: number };
    draft.action = { type: 'set_stock', itemName: a.item_name.trim(), stock: a.stock };
    return `Staged setting "${a.item_name.trim()}" stock to ${a.stock}.`;
  },
};

const restockInventoryTool: CopilotTool = {
  def: {
    name: 'restock_inventory',
    description:
      'Add units to an item\'s current stock, e.g. "restock 10 more Bridal Lehengas" or "we got 20 more units in". ' +
      'Use this instead of set_inventory_stock when the owner is describing an ADDITION rather than stating the ' +
      'exact new total. This PROPOSES the change — nothing updates until the owner approves it.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['item_name', 'add_units'],
      properties: {
        item_name: { type: 'string', description: 'The catalogue item name, as it appears in the catalogue.' },
        add_units: { type: 'integer', minimum: 1, description: 'How many units to add to the current stock.' },
      },
    },
  },
  argsSchema: z.object({
    item_name: z.string().trim().min(1),
    add_units: z.number().int().positive(),
  }),
  async execute(args, draft) {
    const a = args as { item_name: string; add_units: number };
    draft.action = { type: 'restock', itemName: a.item_name.trim(), addUnits: a.add_units };
    return `Staged adding ${a.add_units} units to "${a.item_name.trim()}".`;
  },
};

/* ---------------------------------------------------------------- lookup_customer */

const LOOKUP_LIMIT = 5;
const MESSAGE_PREVIEW_LIMIT = 8;
const MESSAGE_CONTENT_CHARS = 240;

/** Escape ilike wildcards in user-provided search text before building a LIKE pattern. */
function ilikePattern(q: string): string {
  return `%${q.replace(/[%_]/g, '\\$&')}%`;
}

function formatOrderLine(o: {
  status: string;
  payment_status: string;
  items: unknown;
  amount_total: number | null;
  currency: string | null;
  created_at: string;
}): string {
  const items = Array.isArray(o.items)
    ? o.items
        .filter(isRecord)
        .map((i) => (typeof i.name === 'string' ? `${i.name}${typeof i.qty === 'number' ? ` x${i.qty}` : ''}` : ''))
        .filter(Boolean)
        .join(', ')
    : '';
  const total = o.amount_total !== null ? `${o.amount_total} ${o.currency ?? ''}`.trim() : '';
  return [o.created_at.slice(0, 10), `status: ${o.status}`, `payment: ${o.payment_status}`, items, total]
    .filter(Boolean)
    .join(' — ');
}

/**
 * Live DB read scoped to this tenant only — surfaces the same chat/order data
 * the owner already sees on /dashboard/chat and /dashboard/orders, just found by
 * name/phone instead of by scrolling. Uses the service client (like every other
 * tenant-scoped read in services/*.ts) but every query is hard-filtered to
 * `draft.tenant.id`, and search text goes through parameterised `.ilike()` calls
 * (never string-interpolated into a PostgREST `.or()` filter) so a customer name
 * containing filter-syntax characters can't affect the query.
 */
async function lookupCustomer(tenantId: string, query: string): Promise<string> {
  const q = query.trim();
  if (!q) return 'Please provide a customer name or phone number to search for.';

  const client = createServiceClient();
  const pattern = ilikePattern(q);

  const [byNameSessions, byIdSessions, byNameOrders, byPhoneOrders] = await Promise.all([
    client
      .from('chat_sessions')
      .select('id, customer_name, external_user_id, platform, is_human_handoff, alert_signal, summary, created_at')
      .eq('tenant_id', tenantId)
      .ilike('customer_name', pattern)
      .order('created_at', { ascending: false })
      .limit(LOOKUP_LIMIT),
    client
      .from('chat_sessions')
      .select('id, customer_name, external_user_id, platform, is_human_handoff, alert_signal, summary, created_at')
      .eq('tenant_id', tenantId)
      .ilike('external_user_id', pattern)
      .order('created_at', { ascending: false })
      .limit(LOOKUP_LIMIT),
    client
      .from('orders')
      .select('id, customer_name, customer_phone, status, payment_status, items, amount_total, currency, created_at')
      .eq('tenant_id', tenantId)
      .ilike('customer_name', pattern)
      .order('created_at', { ascending: false })
      .limit(LOOKUP_LIMIT),
    client
      .from('orders')
      .select('id, customer_name, customer_phone, status, payment_status, items, amount_total, currency, created_at')
      .eq('tenant_id', tenantId)
      .ilike('customer_phone', pattern)
      .order('created_at', { ascending: false })
      .limit(LOOKUP_LIMIT),
  ]);

  for (const r of [byNameSessions, byIdSessions, byNameOrders, byPhoneOrders]) {
    if (r.error) throw r.error;
  }

  const sessionsById = new Map((byNameSessions.data ?? []).concat(byIdSessions.data ?? []).map((s) => [s.id, s]));
  const sessions = Array.from(sessionsById.values())
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, LOOKUP_LIMIT);

  const ordersById = new Map((byNameOrders.data ?? []).concat(byPhoneOrders.data ?? []).map((o) => [o.id, o]));
  const orders = Array.from(ordersById.values())
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, LOOKUP_LIMIT);

  if (!sessions.length && !orders.length) return `No customer matching "${q}" was found.`;

  const lines: string[] = [];

  if (sessions.length) {
    lines.push('Chats:');
    for (const s of sessions) {
      const label = s.customer_name || s.external_user_id;
      const handoff = s.is_human_handoff ? 'handed off to a human' : 'AI handling';
      const alert = s.alert_signal ? `, alert: ${s.alert_signal}` : '';
      lines.push(`- ${label} (${s.platform}) — ${handoff}${alert}, last active ${s.created_at.slice(0, 10)}`);
      if (s.summary) lines.push(`  summary: ${s.summary.slice(0, MESSAGE_CONTENT_CHARS)}`);
    }

    const mostRecentSessionId = sessions[0]?.id;
    if (mostRecentSessionId) {
      const { data: messages, error: messagesError } = await client
        .from('chat_messages')
        .select('role, content, created_at')
        .eq('tenant_id', tenantId)
        .eq('session_id', mostRecentSessionId)
        .order('created_at', { ascending: false })
        .limit(MESSAGE_PREVIEW_LIMIT);
      if (messagesError) throw messagesError;
      if (messages?.length) {
        lines.push('Recent messages (most recent chat, newest first):');
        for (const m of messages) {
          lines.push(`  [${m.role}] ${m.content.slice(0, MESSAGE_CONTENT_CHARS)}`);
        }
      }
    }
  }

  if (orders.length) {
    lines.push('Orders:');
    for (const o of orders) lines.push(`- ${o.customer_name ?? o.customer_phone ?? 'unknown'}: ${formatOrderLine(o)}`);
  }

  return lines.join('\n');
}

const lookupCustomerTool: CopilotTool = {
  def: {
    name: 'lookup_customer',
    description:
      'Look up ONE specific customer of this business by name or phone number: their recent chat conversations ' +
      '(is it AI-handled or handed off, any alert, a summary, and recent messages) and their recent orders (status, ' +
      'payment, items, total). Use this when the owner asks about a named customer, e.g. "what\'s going on with ' +
      'Ayesha\'s order" or "did Bilal ever reply". Read-only — does not propose any change.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', description: "The customer's name or phone number, as the owner said it." },
      },
    },
  },
  argsSchema: z.object({ query: z.string().min(1) }),
  async execute(args, draft) {
    const a = args as { query: string };
    return lookupCustomer(draft.tenant.id, a.query);
  },
};

const COPILOT_TOOLS: CopilotTool[] = [
  updatePersonaTool,
  reviseCatalogueTool,
  updateKnowledgeTool,
  setHoursTool,
  setHolidayClosureTool,
  clearHolidayClosureTool,
  setBusinessBasicsTool,
  setCustomOrdersTool,
  setMediaVoiceTool,
  configurePaymentsTool,
  importFromUrlTool,
  inviteTeamMemberTool,
  setInventoryStockTool,
  restockInventoryTool,
  lookupCustomerTool,
];

export function getCopilotToolDefs(): LlmToolDef[] {
  return COPILOT_TOOLS.map((t) => t.def);
}

/**
 * Parse + validate the model's args, then run the (side-effect-free) executor,
 * which stages a slice into `draft`. Returns a short string the model reads back
 * as the tool result. Never throws — a tool failure becomes an error string the
 * model can recover from, mirroring services/tools/registry.ts.
 */
export async function executeCopilotTool(call: LlmToolCall, draft: CopilotDraft): Promise<string> {
  const tool = COPILOT_TOOLS.find((t) => t.def.name === call.name);
  if (!tool) return `Unknown tool: ${call.name}`;

  let rawArgs: unknown;
  try {
    rawArgs = JSON.parse(call.arguments);
  } catch {
    return 'Invalid arguments: not valid JSON.';
  }

  const parsed = tool.argsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return `Invalid arguments: ${parsed.error.issues[0]?.message ?? 'validation failed'}`;
  }

  try {
    return await tool.execute(parsed.data, draft);
  } catch (err) {
    log.error('[copilot] tool execution failed', {
      tool: call.name,
      tenantId: draft.tenant.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return err instanceof Error && err.message.length <= 200
      ? `That step failed: ${err.message}`
      : 'That step failed. Try describing the change a different way.';
  }
}
