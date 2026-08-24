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
  it('free: 100 conversations/month, mid-sized only, one channel, no AI assistant', () => {
    expect(ENTITLEMENTS.free.monthlyConversations).toBe(100);
    expect(ENTITLEMENTS.free.maxMessagesPerConversation).toBe(20);
    expect(ENTITLEMENTS.free.maxChannels).toBe(1);
    expect(ENTITLEMENTS.free.hasCopilot).toBe(false);
  });

  it('starter ($39): 500/month, unlimited length and ALL channels', () => {
    expect(ENTITLEMENTS.starter.monthlyConversations).toBe(500);
    expect(isLimited(ENTITLEMENTS.starter.maxMessagesPerConversation)).toBe(false);
    expect(isLimited(ENTITLEMENTS.starter.maxChannels)).toBe(false);
  });

  it('starter ($39) does NOT include the AI assistant — that is the Growth upsell', () => {
    expect(ENTITLEMENTS.starter.hasCopilot).toBe(false);
  });

  it('growth ($49): 2000/month and the AI assistant', () => {
    expect(ENTITLEMENTS.growth.monthlyConversations).toBe(2000);
    expect(ENTITLEMENTS.growth.hasCopilot).toBe(true);
    expect(isLimited(ENTITLEMENTS.growth.maxChannels)).toBe(false);
  });

  it('pro ($79): 10000/month, keeps the AI assistant', () => {
    expect(ENTITLEMENTS.pro.monthlyConversations).toBe(10_000);
    expect(ENTITLEMENTS.pro.hasCopilot).toBe(true);
  });

  it('enterprise: unlimited conversations, keeps the AI assistant', () => {
    expect(isLimited(ENTITLEMENTS.enterprise.monthlyConversations)).toBe(false);
    expect(ENTITLEMENTS.enterprise.hasCopilot).toBe(true);
  });

  it('monthly conversation allowance never decreases as tiers go up', () => {
    const caps = PLAN_IDS.map((p) => ENTITLEMENTS[p].monthlyConversations);
    for (let i = 1; i < caps.length; i++) {
      expect(caps[i]).toBeGreaterThanOrEqual(caps[i - 1]);
    }
  });

  it('no paid tier advertises the exact same headline conversation cap as the tier below it (D-07)', () => {
    for (let i = 1; i < PLAN_IDS.length; i++) {
      const lower = ENTITLEMENTS[PLAN_IDS[i - 1]].monthlyConversations;
      const higher = ENTITLEMENTS[PLAN_IDS[i]].monthlyConversations;
      expect(higher, `${PLAN_IDS[i]} must not repeat ${PLAN_IDS[i - 1]}'s exact cap`).not.toBe(lower);
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
    for (const bad of ['enterprise_v2', 'starter_v2', '', 'PRO', null, undefined]) {
      expect(entitlementsFor(bad)).toBe(ENTITLEMENTS.free);
    }
  });
});

describe('entitlements ignore plan_status — why signup must provision on free', () => {
  it('grants a tier purely from `tenants.plan`, with no pending/unpaid concept', () => {
    expect(entitlementsFor('pro')).toBe(ENTITLEMENTS.pro);
    expect(entitlementsFor('enterprise')).toBe(ENTITLEMENTS.enterprise);
    expect(entitlementsFor('free')).toBe(ENTITLEMENTS.free);
    expect(entitlementsFor.length).toBe(1);
  });
});

describe('plan id guards', () => {
  it('isPlanId accepts every real plan and rejects others', () => {
    for (const id of PLAN_IDS) expect(isPlanId(id)).toBe(true);
    expect(isPlanId('enterprise_v2')).toBe(false);
    expect(isPlanId('Free')).toBe(false);
  });

  it('isPaidPlanId includes enterprise and excludes free', () => {
    expect(isPaidPlanId('free')).toBe(false);
    expect(isPaidPlanId('enterprise')).toBe(true);
    for (const id of PAID_PLAN_IDS) expect(isPaidPlanId(id)).toBe(true);
  });

  it('every paid plan id is also a plan id', () => {
    for (const id of PAID_PLAN_IDS) expect(isPlanId(id)).toBe(true);
  });
});

describe('display helpers', () => {
  it('names every plan', () => {
    expect(planDisplayName('free')).toBe('Free');
    expect(planDisplayName('starter')).toBe('Starter');
    expect(planDisplayName('growth')).toBe('Growth');
    expect(planDisplayName('pro')).toBe('Pro');
    expect(planDisplayName('enterprise')).toBe('Enterprise');
  });

  it('falls back to Free for an unknown plan rather than throwing', () => {
    expect(planDisplayName('nope')).toBe('Free');
    expect(planDisplayName(null)).toBe('Free');
  });

  it('ranks tiers in ascending order for upgrade/downgrade comparisons', () => {
    expect(planRank('free')).toBeLessThan(planRank('starter'));
    expect(planRank('starter')).toBeLessThan(planRank('growth'));
    expect(planRank('growth')).toBeLessThan(planRank('pro'));
    expect(planRank('pro')).toBeLessThan(planRank('enterprise'));
  });

  it('formatLimit renders a number or Unlimited', () => {
    expect(formatLimit(5)).toBe('5');
    expect(formatLimit(20)).toBe('20');
    expect(formatLimit(Infinity)).toBe('Unlimited');
  });
});
