import { describe, it, expect } from 'vitest';
import {
  ENTITLEMENTS,
  entitlementsFor,
  formatLimit,
  isLimited,
  isPaidPlanId,
  isPlanId,
  planDisplayName,
  planRank,
  PAID_PLAN_IDS,
  PLAN_IDS,
} from './entitlements';

/**
 * These pin the actual commercial promises. If a test here fails, either a plan
 * was repriced/repositioned deliberately (update the test) or enforcement just
 * silently drifted away from what customers were sold.
 */
describe('plan entitlements — the advertised limits', () => {
  it('free: 5 conversations/day, mid-sized only, one channel, no AI assistant', () => {
    expect(ENTITLEMENTS.free.dailyConversations).toBe(5);
    expect(ENTITLEMENTS.free.maxMessagesPerConversation).toBe(20);
    expect(ENTITLEMENTS.free.maxChannels).toBe(1);
    expect(ENTITLEMENTS.free.hasCopilot).toBe(false);
  });

  it('starter ($39): still 5/day, but unlimited length and ALL channels', () => {
    expect(ENTITLEMENTS.starter.dailyConversations).toBe(5);
    expect(isLimited(ENTITLEMENTS.starter.maxMessagesPerConversation)).toBe(false);
    expect(isLimited(ENTITLEMENTS.starter.maxChannels)).toBe(false);
  });

  it('starter ($39) does NOT include the AI assistant — that is the Growth upsell', () => {
    expect(ENTITLEMENTS.starter.hasCopilot).toBe(false);
  });

  it('growth ($49): 20/day and the AI assistant', () => {
    expect(ENTITLEMENTS.growth.dailyConversations).toBe(20);
    expect(ENTITLEMENTS.growth.hasCopilot).toBe(true);
    expect(isLimited(ENTITLEMENTS.growth.maxChannels)).toBe(false);
  });

  it('pro ($79): unlimited conversations, keeps the AI assistant', () => {
    expect(isLimited(ENTITLEMENTS.pro.dailyConversations)).toBe(false);
    expect(ENTITLEMENTS.pro.hasCopilot).toBe(true);
  });

  it('daily conversation allowance never decreases as tiers go up', () => {
    // Guards against a paste error making a higher tier worse than a lower one.
    const caps = PLAN_IDS.map((p) => ENTITLEMENTS[p].dailyConversations);
    for (let i = 1; i < caps.length; i++) {
      expect(caps[i]).toBeGreaterThanOrEqual(caps[i - 1]);
    }
  });

  it('every plan id has an entitlements entry', () => {
    for (const id of PLAN_IDS) expect(ENTITLEMENTS[id]).toBeDefined();
  });
});

describe('entitlementsFor — resolving a plan string from the database', () => {
  it('resolves each known plan', () => {
    for (const id of PLAN_IDS) {
      expect(entitlementsFor(id)).toBe(ENTITLEMENTS[id]);
    }
  });

  it('falls back to FREE for unknown/legacy/missing values, never to a paid tier', () => {
    // The safe direction: under-serving is fixed by an upgrade; over-serving is
    // revenue silently lost with no signal anywhere.
    for (const bad of ['enterprise', 'starter_v2', '', 'PRO', null, undefined]) {
      expect(entitlementsFor(bad)).toBe(ENTITLEMENTS.free);
    }
  });
});

describe('entitlements ignore plan_status — why signup must provision on free', () => {
  it('grants a tier purely from `tenants.plan`, with no pending/unpaid concept', () => {
    // This is the reason `provisionTenantAction` writes plan:'free' even when a
    // paid tier was selected. There is deliberately no `plan_status` input here:
    // a 'pending_upgrade' row is indistinguishable from a paid one to this
    // function, so writing the SELECTED tier at signup would hand a visitor full
    // entitlements before any money moved — pick Pro, abandon checkout, keep
    // unlimited everything forever. The billing webhook is the only writer of
    // `tenants.plan` (docs/26 §4).
    expect(entitlementsFor('pro')).toBe(ENTITLEMENTS.pro);
    expect(entitlementsFor('free')).toBe(ENTITLEMENTS.free);
    // entitlementsFor takes ONE argument. If a future change adds a status
    // parameter, this assertion is the prompt to revisit the signup path.
    expect(entitlementsFor.length).toBe(1);
  });
});

describe('plan id guards', () => {
  it('isPlanId accepts every real plan and rejects others', () => {
    for (const id of PLAN_IDS) expect(isPlanId(id)).toBe(true);
    expect(isPlanId('enterprise')).toBe(false);
    expect(isPlanId('Free')).toBe(false); // case-sensitive on purpose — ids are exact db values
  });

  it('isPaidPlanId excludes free — free is not purchasable', () => {
    expect(isPaidPlanId('free')).toBe(false);
    for (const id of PAID_PLAN_IDS) expect(isPaidPlanId(id)).toBe(true);
  });

  it('every paid plan id is also a plan id', () => {
    for (const id of PAID_PLAN_IDS) expect(isPlanId(id)).toBe(true);
  });
});

describe('display helpers', () => {
  it('names every plan, including the one a two-way ternary used to miss', () => {
    expect(planDisplayName('free')).toBe('Free');
    expect(planDisplayName('starter')).toBe('Starter');
    expect(planDisplayName('growth')).toBe('Growth');
    expect(planDisplayName('pro')).toBe('Pro');
  });

  it('falls back to Free for an unknown plan rather than throwing', () => {
    expect(planDisplayName('nope')).toBe('Free');
    expect(planDisplayName(null)).toBe('Free');
  });

  it('ranks tiers in ascending order for upgrade/downgrade comparisons', () => {
    expect(planRank('free')).toBeLessThan(planRank('starter'));
    expect(planRank('starter')).toBeLessThan(planRank('growth'));
    expect(planRank('growth')).toBeLessThan(planRank('pro'));
  });

  it('formatLimit renders a number or Unlimited', () => {
    expect(formatLimit(5)).toBe('5');
    expect(formatLimit(20)).toBe('20');
    expect(formatLimit(Infinity)).toBe('Unlimited');
  });
});
