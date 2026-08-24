/**
 * Plan entitlements — the SINGLE source of truth for what each plan allows.
 *
 * Plain data + pure functions, no imports from services, so this can be read by
 * server code (orchestrator, server actions), client components (billing panel,
 * copilot gating) and tests alike. `'use server'` files may only export async
 * functions, which is why this lives in lib/ and not next to the plan config.
 *
 * WHY ONE MODULE: before this existed, "Up to 5 conversations/month" was a string
 * in the plan card while `FREE_PLAN_DAILY_SESSION_CAP` was a separate constant
 * in lib/constants, and "One channel at a time" was marketing copy enforced
 * nowhere at all. Marketing copy and enforcement drifting apart is how a paywall
 * quietly stops matching what customers were sold. Everything a plan grants is
 * now derived from ENTITLEMENTS, including the feature bullets on the cards.
 */

/** Plan ids exactly as written to `tenants.plan`. */
export type PlanId = 'free' | 'starter' | 'growth' | 'pro' | 'enterprise';

export const PLAN_IDS: readonly PlanId[] = ['free', 'starter', 'growth', 'pro', 'enterprise'] as const;

/** Paid plans a tenant can self-serve checkout into. Free is not purchasable. */
export type PaidPlanId = Exclude<PlanId, 'free'>;

export const PAID_PLAN_IDS: readonly PaidPlanId[] = ['starter', 'growth', 'pro', 'enterprise'] as const;

/** `Infinity` means unlimited — deliberately not `null`, so comparisons stay plain numbers. */
export interface PlanEntitlements {
  /** New conversations that may START per UTC month. Existing conversations are never blocked by this. */
  monthlyConversations: number;
  /**
   * Max CUSTOMER messages in a single conversation before the AI stops replying
   * and hands off to a human (§ "mid-sized conversations only"). Counts inbound
   * customer turns only — the AI's own replies don't consume the budget, or a
   * chatty assistant would shorten the customer's allowance.
   */
  maxMessagesPerConversation: number;
  /** How many channels (WhatsApp/Messenger/Instagram/web) may be connected at once. */
  maxChannels: number;
  /** The owner-facing "personal AI assistant" (the ClerkAI Copilot). */
  hasCopilot: boolean;
}

export const ENTITLEMENTS: Record<PlanId, PlanEntitlements> = {
  free: {
    monthlyConversations: 100,
    maxMessagesPerConversation: 20,
    maxChannels: 1,
    hasCopilot: false,
  },
  starter: {
    monthlyConversations: 500,
    maxMessagesPerConversation: Infinity,
    maxChannels: Infinity,
    hasCopilot: false,
  },
  growth: {
    monthlyConversations: 2000,
    maxMessagesPerConversation: Infinity,
    maxChannels: Infinity,
    hasCopilot: true,
  },
  pro: {
    monthlyConversations: 10_000,
    maxMessagesPerConversation: Infinity,
    maxChannels: Infinity,
    hasCopilot: true,
  },
  enterprise: {
    monthlyConversations: Infinity,
    maxMessagesPerConversation: Infinity,
    maxChannels: Infinity,
    hasCopilot: true,
  },
};

/**
 * Entitlements for a plan string read from the database.
 *
 * Unknown/legacy values fall back to `free` — the SAFE direction. A typo or a
 * plan id retired in a future migration must never silently grant unlimited
 * everything; under-serving is recoverable by an upgrade, over-serving is
 * revenue quietly lost with no signal.
 */
export function entitlementsFor(plan: string | null | undefined): PlanEntitlements {
  if (plan && isPlanId(plan)) return ENTITLEMENTS[plan];
  return ENTITLEMENTS.free;
}

export function isPlanId(value: string): value is PlanId {
  return (PLAN_IDS as readonly string[]).includes(value);
}

export function isPaidPlanId(value: string): value is PaidPlanId {
  return (PAID_PLAN_IDS as readonly string[]).includes(value);
}

/** True when this plan caps the value (i.e. it isn't unlimited). */
export function isLimited(limit: number): boolean {
  return Number.isFinite(limit);
}

/** Human-readable limit for UI copy: `5`, or `Unlimited`. */
export function formatLimit(limit: number): string {
  return isLimited(limit) ? String(limit) : 'Unlimited';
}

/**
 * Display name for a plan id.
 *
 * Lives here rather than being derived from PAYWALL_PLANS so that server-side
 * callers with no business importing UI plan config (the billing webhooks, which
 * name the plan in a notification) still get the right label. A ternary over two
 * ids was already wrong the moment a third tier existed.
 */
const PLAN_NAMES: Record<PlanId, string> = {
  free: 'Free',
  starter: 'Starter',
  growth: 'Growth',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

export function planDisplayName(plan: string | null | undefined): string {
  if (plan && isPlanId(plan)) return PLAN_NAMES[plan];
  return PLAN_NAMES.free;
}

/**
 * Ordering position of a plan, low → high. Only for comparing tiers in the UI
 * (is this an upgrade or a downgrade?) — never for deciding entitlements, which
 * must always be read from ENTITLEMENTS so a future non-linear tier can't be
 * accidentally granted everything below it.
 */
export function planRank(plan: string | null | undefined): number {
  const index = plan && isPlanId(plan) ? PLAN_IDS.indexOf(plan) : -1;
  return index === -1 ? 0 : index;
}
