import { redirect } from 'next/navigation';
import { getCallerContext } from '@/lib/auth/context';
import { OnboardingClient } from './onboarding-client';

/**
 * Self-serve onboarding (docs: "try it for your business" plan, Phase C —
 * direct-signup path). Lands here after signup verify (typed code or Google
 * OAuth) when there's no demo handoff to provision from, and when a returning
 * user with no tenant signs in (the dashboard layout redirects here too).
 *
 * Server guard keeps the three unreachable cases out before the client
 * wizard ever mounts: not signed in → login; agency staff → admin tree; an
 * account that already has a tenant → dashboard. The wizard itself is a
 * fresh start every visit — partial progress is intentionally not persisted
 * (product decision: a returning user redoes the form, not resumes it).
 */
export default async function OnboardingPage() {
  const ctx = await getCallerContext();
  if (!ctx) redirect('/login');
  if (ctx.isPlatformAdmin) redirect('/admin');
  if (ctx.memberships.length > 0) redirect('/dashboard');
  return <OnboardingClient />;
}
