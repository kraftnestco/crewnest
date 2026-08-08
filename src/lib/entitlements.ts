/**
 * Plan entitlements — the SINGLE source of truth for what each plan allows.
 *
 * Plain data + pure functions, no imports from services, so this can be read by
 * server code (orchestrator, server actions), client components (billing panel,
 * copilot gating) and tests alike. `'use server'` files may only export async
 * functions, which is why this lives in lib/ and not next to the plan config.
 *
 * WHY ONE MODULE: before this existed, "Up to 5 conversations/day" was a string
 * in the plan card while `FREE_PLAN_DAILY_SESSION_CAP` was a separate constant
 * in lib/constants, and "One channel at a time" was marketing copy enforced
 * nowhere at all. Marketing copy and enforcement drifting apart is how a paywall
 * quietly stops matching what customers were sold. Everything a plan grants is
 * now derived from ENTITLEMENTS, including the feature bullets on the cards.
 */

/** Plan ids exactly as written to `tenants.plan`. */
export type PlanId = 'free' | 'starter' | 'growth' | 'pro';

export const PLAN_IDS: readonly PlanId[] = ['free', 'starter', 'growth', 'pro'] as const;

/** Paid plans a tenant can check out into (free is not purchasable). */
export type PaidPlanId = Exclude<PlanId, 'free'>;

export const PAID_PLAN_IDS: readonly PaidPlanId[] = ['starter', 'growth', 'pro'] as const;

/** `Infinity` means unlimited — deliberately not `null`, so comparisons stay plain numbers. */
export interface PlanEntitlements {
  /** New conversations that may START per UTC day. Existing conversations are never blocked by this. */
  dailyConversations: number;
  /**
   * Max CUSTOMER messages in a single conversation before the AI stops replying
   * and hands off to a human (§ "mid-sized conversations only"). Counts inbound
   * customer turns only — the AI's own replies don't consume the budget, or a
   * chatty assistant would shorten the customer's allowance.
   */
  maxMessagesPerConversation: number;
  /** How many channels (WhatsApp/Messenger/Instagram/web) may be connected at once. */
  maxChannels: number;
  /** The owner-facing "personal AI assistant" (the CrewAI Copilot). */
  hasCopilot: boolean;
}

export const ENTITLEMENTS: Record<PlanId, PlanEntitlements> = {
  free: {
    dailyConversations: 5,
    maxMessagesPerConversation: 20,
    maxChannels: 1,
    hasCopilot: false,
  },
  starter: {
    // Was 5 — identical to Free, so the $39 upgrade had no visible reason to
    // exist beyond message length/channel count (docs/27 §3 M9, D-07; user
    // decision: raise Starter's own cap rather than leave the tiers tied).
    // 15, not the doc's example of 50 — Growth ($49, one tier up) caps at 20,
    // and 50 would have made the CHEAPER tier out-volume the pricier one.
    // Kept below Growth so the existing "daily cap never decreases going up
    // the ladder" invariant (entitlements.test.ts) holds without also having
    // to reprice Growth, which wasn't part of this decision.
    dailyConversations: 15,
    maxMessagesPerConversation: Infinity,
    maxChannels: Infinity,
    hasCopilot: false,
  },
  growth: {
    dailyConversations: 20,
    maxMessagesPerConversation: Infinity,
    maxChannels: Infinity,
    hasCopilot: true,
  },
  pro: {
    dailyConversations: Infinity,
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
