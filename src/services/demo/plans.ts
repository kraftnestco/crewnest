/**
 * Paywall plan config (docs: "try it for your business" plan, Phase C). Plain
 * data only — kept out of any `'use server'` file, since those may only export
 * async functions. `id` is the exact string written to `tenants.plan`.
 */
export interface PlanOption {
  id: 'free' | 'starter' | 'pro';
  name: string;
  price: string;
  tagline: string;
  features: string[];
}

export const PAYWALL_PLANS: PlanOption[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0/mo',
    tagline: 'Keep the AI you just built, capped for solo testing.',
    features: ['Up to 5 customer conversations/day', 'One channel at a time', 'Community support'],
  },
  {
    id: 'starter',
    name: 'Starter',
    price: '$29/mo',
    tagline: 'For a business that outgrew the free cap.',
    features: ['Unlimited customer conversations', 'WhatsApp + Instagram + Messenger', 'Order capture & payments'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$79/mo',
    tagline: 'For teams who want the full command center.',
    features: ['Everything in Starter', 'Multiple team seats & roles', 'Priority support'],
  },
];
