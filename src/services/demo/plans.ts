import { ENTITLEMENTS, formatLimit, type PlanId } from '@/lib/entitlements';

/**
 * Paywall plan config. Plain data only — kept out of any `'use server'` file.
 * `id` is the exact string written to `tenants.plan`.
 *
 * LIMIT bullets are derived from `ENTITLEMENTS` so a card can never advertise a
 * cap the enforcement code doesn't apply.
 */
export interface PlanOption {
  id: PlanId;
  name: string;
  price: string;
  /**
   * Display price for Pakistan (Safepay) visitors/tenants (docs/25 §3.2).
   * Fixed PKR plan amounts — Safepay bills the dashboard plan, not a converted USD.
   */
  pricePkr?: string;
  tagline: string;
  features: string[];
  /** Rendered as the emphasised card in the pricing grid. */
  highlight?: boolean;
}

/** Marketing-only Enterprise card — not a checkoutable `tenants.plan` id. */
export interface EnterprisePlanOption {
  id: 'enterprise';
  name: string;
  price: string;
  pricePkr?: string;
  tagline: string;
  features: string[];
  cta: string;
}

function conversationsFeature(plan: PlanId): string {
  const n = ENTITLEMENTS[plan].monthlyConversations;
  if (!Number.isFinite(n)) return 'Unlimited AI conversations';
  return `Up to ${n.toLocaleString('en-US')} AI conversations / month`;
}

function channelsFeature(plan: PlanId): string {
  const n = ENTITLEMENTS[plan].maxChannels;
  return Number.isFinite(n) ? '1 channel at a time' : 'All channels — WhatsApp, Instagram, Messenger & web';
}

export const PAYWALL_PLANS: PlanOption[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0/mo',
    pricePkr: 'Rs 0/mo',
    tagline: 'Try ClerkNest on one channel, no commitment.',
    features: [
      conversationsFeature('free'),
      `Up to ${formatLimit(ENTITLEMENTS.free.maxMessagesPerConversation)} messages per conversation`,
      channelsFeature('free'),
      'Community support',
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    price: '$11/mo',
    pricePkr: 'Rs 3,000/mo',
    tagline: 'For solo shops getting serious about one channel.',
    features: [
      conversationsFeature('starter'),
      'Conversations of any length',
      channelsFeature('starter'),
      'Order capture & payments',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    price: '$49/mo',
    pricePkr: 'Rs 14,000/mo',
    tagline: 'Every channel, one AI brain.',
    highlight: true,
    features: [
      'Everything in Starter',
      conversationsFeature('growth'),
      channelsFeature('growth'),
      'Your own AI assistant to run the business',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$79/mo',
    pricePkr: 'Rs 22,000/mo',
    tagline: 'Higher limits for busy teams.',
    features: [
      'Everything in Growth',
      conversationsFeature('pro'),
      'Multiple team seats & roles',
      'Priority support',
    ],
  },
];

/** Enterprise — Talk to Sales. Shown on marketing grids; not provisioned via checkout. */
export const ENTERPRISE_PLAN: EnterprisePlanOption = {
  id: 'enterprise',
  name: 'Enterprise',
  price: 'Custom',
  pricePkr: 'Custom',
  tagline: 'Custom volume, SLA, and success support — scoped with us.',
  features: [
    'Custom conversation volume',
    'All channels',
    'Everything in Pro',
    'Dedicated success manager',
    'Custom SLA',
  ],
  cta: 'Talk to Sales',
};

/** All cards shown on public marketing surfaces (paywall + Enterprise). */
export const MARKETING_PLANS = [...PAYWALL_PLANS, ENTERPRISE_PLAN] as const;

/** Pick the display price string for a visitor/tenant currency. */
export function planPriceLabel(
  plan: Pick<PlanOption, 'price' | 'pricePkr'> | Pick<EnterprisePlanOption, 'price' | 'pricePkr'>,
  currency: 'USD' | 'PKR',
): string {
  if (currency === 'PKR') return plan.pricePkr ?? plan.price;
  return plan.price;
}
