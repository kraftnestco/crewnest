import type { Database } from '@/types/database';

/** Fields the intake flow reads/writes — shared by the admin form and the client wizard. */
export type IntakeTenant = Pick<
  Database['public']['Tables']['tenants']['Row'],
  | 'id'
  | 'system_prompt'
  | 'catalog_data'
  | 'catalog_freeform_text'
  | 'custom_orders_enabled'
  | 'custom_orders_require_approval'
  | 'custom_order_instructions'
  | 'media_handling'
  | 'business_type'
  | 'booking_link'
  | 'knowledge_base'
  | 'business_hours'
  | 'timezone'
  | 'payments_enabled'
  | 'payment_methods'
  | 'payment_instructions'
  | 'default_currency'
  | 'prepaid_required'
>;

export interface FaqEntry {
  q: string;
  a: string;
}

export interface KnowledgeBaseState {
  faq: FaqEntry[];
  delivery: string;
  returns: string;
  location: string;
  note: string;
}

export interface HourRow {
  day: string;
  open: string;
  close: string;
}

export interface BusinessHoursState {
  week: HourRow[];
  note: string;
}

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function parseKnowledgeBase(raw: unknown): KnowledgeBaseState {
  const obj = isRecord(raw) ? raw : {};
  const faqRaw = Array.isArray(obj.faq) ? obj.faq.filter(isRecord) : [];
  return {
    faq: faqRaw.map((e) => ({ q: typeof e.q === 'string' ? e.q : '', a: typeof e.a === 'string' ? e.a : '' })),
    delivery: typeof obj.delivery === 'string' ? obj.delivery : '',
    returns: typeof obj.returns === 'string' ? obj.returns : '',
    location: typeof obj.location === 'string' ? obj.location : '',
    note: typeof obj.note === 'string' ? obj.note : '',
  };
}

export function parseBusinessHours(raw: unknown): BusinessHoursState {
  const obj = isRecord(raw) ? raw : {};
  const weekRaw = Array.isArray(obj.week) ? obj.week.filter(isRecord) : [];
  const byDay = new Map(weekRaw.map((e) => [String(e.day ?? ''), e]));
  return {
    week: DAYS.map((day) => {
      const e = byDay.get(day);
      return {
        day,
        open: e && typeof e.open === 'string' ? e.open : '',
        close: e && typeof e.close === 'string' ? e.close : '',
      };
    }),
    note: typeof obj.note === 'string' ? obj.note : '',
  };
}

export const MEDIA_HANDLING_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  {
    value: 'match_catalogue',
    label: 'Match to my catalogue',
    hint: 'Try to identify the closest catalogue item and capture the delta. (Default)',
  },
  {
    value: 'accept_any',
    label: 'Accept any',
    hint: "Take the request even if it isn't in the catalogue.",
  },
  {
    value: 'reject',
    label: 'Reject',
    hint: 'Politely decline media, ask for a text description instead.',
  },
];

export const BUSINESS_TYPE_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  {
    value: 'product',
    label: 'Product-based',
    hint: 'Sells physical items customers order from a catalogue. (Default)',
  },
  {
    value: 'service',
    label: 'Service-based',
    hint: 'Offers services — appointments/bookings, or custom quotes your team prices.',
  },
];

export const PAYMENT_METHOD_OPTIONS: Array<{ value: string; label: string; hint: string; disabled?: boolean }> = [
  { value: 'cod', label: 'Cash on Delivery', hint: 'No prepayment needed; confirmed on delivery.' },
  {
    value: 'manual_transfer',
    label: 'Bank/Wallet Transfer',
    hint: 'Share your account details; the customer sends a receipt screenshot after paying.',
  },
  {
    value: 'gateway',
    label: 'Card/Online Payment',
    hint: 'Coming soon — needs a payment provider connected first.',
    disabled: true,
  },
];
