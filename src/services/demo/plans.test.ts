import { describe, it, expect } from 'vitest';
import { PAYWALL_PLANS } from './plans';
import { ENTITLEMENTS, PLAN_IDS, isPlanId, isPaidPlanId } from '@/lib/entitlements';

/**
 * The plan CARDS are what a customer reads before paying. These tests exist
 * because the advertised limit and the enforced limit previously lived in
 * separate files ("Up to 100 conversations/month" as a string, the cap as a
 * constant) and could drift apart silently — which is how a paywall quietly
 * stops matching what was sold.
 */
describe('paywall plan cards', () => {
  it('covers every plan id exactly once, in tier order', () => {
    expect(PAYWALL_PLANS.map((p) => p.id)).toEqual([...PLAN_IDS]);
  });

  it('every card id is a real plan id', () => {
    for (const plan of PAYWALL_PLANS) expect(isPlanId(plan.id)).toBe(true);
  });

  it('advertises the prices actually being charged', () => {
    const price = (id: string) => PAYWALL_PLANS.find((p) => p.id === id)?.price;
    expect(price('free')).toBe('$0/mo');
    expect(price('starter')).toBe('$39/mo');
    expect(price('growth')).toBe('$49/mo');
    expect(price('pro')).toBe('$79/mo');
    expect(price('enterprise')).toBe('$199/mo');
  });

  it('every self-serve paid plan carries a PKR price for Safepay tenants', () => {
    for (const plan of PAYWALL_PLANS) {
      if (!isPaidPlanId(plan.id)) continue;
      expect(plan.pricePkr, `${plan.id} has no pricePkr`).toBeTruthy();
    }
  });

  it('states the real monthly conversation limit on every card', () => {
    for (const plan of PAYWALL_PLANS) {
      const cap = ENTITLEMENTS[plan.id].monthlyConversations;
      const bullets = plan.features.join(' | ');
      if (Number.isFinite(cap)) {
        expect(bullets, `${plan.id} should advertise its ${cap}/month cap`).toContain(String(cap));
        expect(bullets.toLowerCase()).toContain('month');
      } else {
        expect(bullets.toLowerCase(), `${plan.id} is uncapped and should say so`).toContain('unlimited');
      }
    }
  });

  it('never advertises a per-day conversation cap', () => {
    for (const plan of PAYWALL_PLANS) {
      const bullets = plan.features.join(' | ').toLowerCase();
      expect(bullets.includes('/day') || bullets.includes('per day')).toBe(false);
    }
  });

  it('only the free card mentions a per-conversation message limit', () => {
    const mentionsLength = (id: string) =>
      PAYWALL_PLANS.find((p) => p.id === id)!
        .features.join(' | ')
        .toLowerCase()
        .includes('messages per conversation');
    expect(mentionsLength('free')).toBe(true);
    expect(mentionsLength('starter')).toBe(false);
    expect(mentionsLength('growth')).toBe(false);
    expect(mentionsLength('pro')).toBe(false);
    expect(mentionsLength('enterprise')).toBe(false);
  });

  it('advertises the AI assistant only on tiers that actually grant it', () => {
    for (const plan of PAYWALL_PLANS) {
      const bullets = plan.features.join(' | ').toLowerCase();
      const claimsAssistant = bullets.includes('ai assistant');
      if (plan.id === 'growth') {
        expect(claimsAssistant).toBe(true);
        expect(ENTITLEMENTS[plan.id].hasCopilot).toBe(true);
      }
      if (claimsAssistant) expect(ENTITLEMENTS[plan.id].hasCopilot).toBe(true);
    }
  });

  it('every paid plan including Enterprise is self-serve checkout (no contact-sales tier)', () => {
    for (const plan of PAYWALL_PLANS) {
      expect(plan.contactSales ?? false).toBe(false);
    }
  });

  it('exactly one plan is highlighted as most popular', () => {
    expect(PAYWALL_PLANS.filter((p) => p.highlight)).toHaveLength(1);
  });

  it('gives every card a name, tagline and at least one feature', () => {
    for (const plan of PAYWALL_PLANS) {
      expect(plan.name).toBeTruthy();
      expect(plan.tagline).toBeTruthy();
      expect(plan.features.length).toBeGreaterThan(0);
    }
  });
});
