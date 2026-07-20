import type { DemoTenantInput } from './schema';

/**
 * sessionStorage contract for carrying the demo's intake + chosen plan across
 * the signup/OAuth redirect (docs: "try it for your business" plan, Phase C).
 * sessionStorage (not React state) because Google OAuth does a full-page
 * round trip through the provider and back via /auth/callback, which drops
 * any in-memory state. Same tab throughout, so sessionStorage survives it.
 */
export const DEMO_HANDOFF_KEY = 'crewnest_demo_handoff';

export interface DemoHandoff {
  demoTenant: DemoTenantInput;
  planId: string;
  email: string;
}
