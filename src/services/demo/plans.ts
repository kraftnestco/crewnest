import { ENTITLEMENTS, type PlanId } from '@/lib/entitlements';

/**
 * Paywall plan config (docs: "try it for your business" plan, Phase C). Plain
 * data only — kept out of any `'use server'` file, since those may only export
 * async functions. `id` is the exact string written to `tenants.plan`.
 *
 * The LIMIT bullets are derived from `ENTITLEMENTS` (lib/entitlements.ts) rather
 * than hand-written, so a card can never advertise a cap the enforcement code
 * doesn't apply. Only genuinely descriptive bullets (support level, seats) are
 * literal strings here.
 */
export interface PlanOption {
  id: PlanId;
  name: string;
  price: string;
  /**
   * Display price for Safepay (Pakistan) tenants (docs/25 §3.2).
   *
   * These are FIXED PKR plan amounts, not the USD price converted at checkout.
   * Safepay's `createSubscription` takes only a planId — amount and currency
   * live on the plan in their merchant dashboard, so there is no field for a
   * converted amount. Changing a price therefore means editing the plan in
   * Safepay AND this string; they are two halves of one change.
   */
  pricePkr?: string;
  tagline: string;
  features: string[];
  /** Rendered as the emphasised card in the pricing grid. */
  highlight?: boolean;
}

/** "Up to 5 customer conversations/day" / "Unlimited customer conversations". */
function conversationsFeature(plan: PlanId): string {
  const n = ENTITLEMENTS[plan].dailyConversations;
  return Number.isFinite(n) ? `Up to ${n} customer conversations/day` : 'Unlimited customer conversations';
}

export const PAYWALL_PLANS: PlanOption[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0/mo',
    tagline: 'Keep the AI you just built, capped for solo testing.',
    features: [
      conversationsFeature('free'),
      `Up to ${ENTITLEMENTS.free.maxMessagesPerConversation} messages per conversation`,
      'One channel at a time',
      'Community support',
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    price: '$39/mo',
    pricePkr: 'Rs 11,000/mo',
    tagline: 'For a business that outgrew the free cap.',
    features: [
      conversationsFeature('starter'),
      'Conversations of any length',
      'All channels — WhatsApp, Instagram, Messenger & web',
      'Order capture & payments',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    price: '$49/mo',
    pricePkr: 'Rs 14,000/mo',
    tagline: 'For a business handling real daily volume.',
    highlight: true,
    features: [
      'Everything in Starter',
      conversationsFeature('growth'),
      'Your own AI assistant to run the business',
      'Order capture & payments',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$79/mo',
    pricePkr: 'Rs 22,000/mo',
    tagline: 'For teams who want the full command center.',
    features: [
      'Everything in Growth',
      conversationsFeature('pro'),
      'Multiple team seats & roles',
      'Priority support',
    ],
  },
];
