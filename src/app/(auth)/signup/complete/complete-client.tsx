'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { provisionTenantAction } from '../provision-actions';
import { createCheckoutSessionAction } from '@/app/dashboard/billing/actions';
import { DEMO_HANDOFF_KEY, BILLING_COUNTRY_KEY, type DemoHandoff } from '@/services/demo/handoff';
// Shared allow-list (lib/entitlements.ts) rather than a local copy — a private
// duplicate here silently skipped checkout for any newly added paid tier.
import { isPaidPlanId } from '@/lib/entitlements';

type Status = 'provisioning' | 'done_pending_upgrade' | 'error';

/**
 * Lands here after either typed-code verify or the Google OAuth round trip
 * (docs: "try it for your business" plan, Phase C). Reads the demo intake +
 * chosen plan out of sessionStorage (the only thing that survives a full-page
 * OAuth redirect) and provisions the real tenant.
 */
export function CompleteClient() {
  const [status, setStatus] = useState<Status>('provisioning');
  const [error, setError] = useState<string | null>(null);
  // Guards against firing provisionTenantAction twice (React Strict Mode's
  // double-invoke in dev, or any remount) — a ref survives across that second
  // effect run, unlike the `cancelled` flag below which only suppresses state
  // updates, not the in-flight server call itself.
  const startedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (startedRef.current) return;
    startedRef.current = true;

    async function run() {
      const raw = sessionStorage.getItem(DEMO_HANDOFF_KEY);
      if (!raw) {
        // No demo handoff -> this is a direct signup (not via /try). Send the
        // user to the onboarding wizard to fill the intake and pick a plan,
        // instead of the old "you're signed in, head to dashboard" card that
        // landed them on the dead-end "Access pending" screen (no tenant was
        // ever created). A returning tenantless user reaches the same wizard
        // via the dashboard layout's redirect.
        if (!cancelled) window.location.assign('/signup/onboarding');
        return;
      }

      let handoff: DemoHandoff;
      try {
        handoff = JSON.parse(raw);
      } catch {
        // Corrupted handoff — treat like none and fall through to onboarding.
        if (!cancelled) window.location.assign('/signup/onboarding');
        return;
      }

      const billingCountry =
        handoff.billingCountry ?? sessionStorage.getItem(BILLING_COUNTRY_KEY) ?? null;
      const result = await provisionTenantAction({
        demoTenant: handoff.demoTenant,
        planId: handoff.planId,
        billingCountry,
      });
      if (cancelled) return;

      if (result.error) {
        setError(result.error);
        setStatus('error');
        return;
      }

      sessionStorage.removeItem(DEMO_HANDOFF_KEY);
      sessionStorage.removeItem(BILLING_COUNTRY_KEY);

      // docs/22-BILLING-STRIPE.md §4: a paid-plan selection now goes straight
      // to real Stripe Checkout instead of landing on a "we'll email you"
      // holding page (provisionTenantAction still stamps plan_status=
      // 'pending_upgrade' first — the webhook clears it once payment actually
      // completes, so an abandoned checkout correctly stays pending, not silently free).
      if (result.planStatus === 'pending_upgrade' && result.tenantId && isPaidPlanId(handoff.planId)) {
        const checkout = await createCheckoutSessionAction(result.tenantId, handoff.planId);
        if (cancelled) return;
        if (checkout.url) {
          window.location.assign(checkout.url);
          return;
        }
        // Checkout couldn't be created (e.g. Stripe not configured yet) — the
        // tenant already exists on the free plan with pending_upgrade set, so
        // fall back to the same holding message rather than losing the account.
        setStatus('done_pending_upgrade');
        return;
      }

      // Hard navigation, not router.push(): /dashboard's server-side auth
      // check needs to see the session that was just established, the same
      // reasoning as verify-code-form.tsx's redirect.
      window.location.assign('/dashboard');
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'done_pending_upgrade') {
    return (
      <Card className="mx-auto max-w-sm">
        <CardHeader>
          <CardTitle>Thanks, request sent!</CardTitle>
          <CardDescription>
            Your AI employee is live on the free plan for now. Our team will reach out shortly to activate your paid
            plan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={() => window.location.assign('/dashboard')}>
            Go to dashboard
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (status === 'error') {
    return (
      <Card className="mx-auto max-w-sm">
        <CardHeader>
          <CardTitle>Something went wrong</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={() => window.location.assign('/dashboard')}>
            Go to dashboard
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-sm">
      <CardHeader>
        <CardTitle>Setting up your AI employee…</CardTitle>
        <CardDescription>This only takes a moment.</CardDescription>
      </CardHeader>
    </Card>
  );
}
