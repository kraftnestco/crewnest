'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { provisionTenantAction } from '../provision-actions';
import { DEMO_HANDOFF_KEY, type DemoHandoff } from '@/services/demo/handoff';

type Status = 'provisioning' | 'done_pending_upgrade' | 'nothing_to_provision' | 'error';

/**
 * Lands here after either typed-code verify or the Google OAuth round trip
 * (docs: "try it for your business" plan, Phase C). Reads the demo intake +
 * chosen plan out of sessionStorage (the only thing that survives a full-page
 * OAuth redirect) and provisions the real tenant.
 */
export function CompleteClient() {
  const [status, setStatus] = useState<Status>('provisioning');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const raw = sessionStorage.getItem(DEMO_HANDOFF_KEY);
      if (!raw) {
        if (!cancelled) setStatus('nothing_to_provision');
        return;
      }

      let handoff: DemoHandoff;
      try {
        handoff = JSON.parse(raw);
      } catch {
        if (!cancelled) setStatus('nothing_to_provision');
        return;
      }

      const result = await provisionTenantAction({ demoTenant: handoff.demoTenant, planId: handoff.planId });
      if (cancelled) return;

      if (result.error) {
        setError(result.error);
        setStatus('error');
        return;
      }

      sessionStorage.removeItem(DEMO_HANDOFF_KEY);
      if (result.planStatus === 'pending_upgrade') {
        setStatus('done_pending_upgrade');
      } else {
        // Hard navigation, not router.push(): /dashboard's server-side auth
        // check needs to see the session that was just established, the same
        // reasoning as verify-code-form.tsx's redirect.
        window.location.assign('/dashboard');
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'nothing_to_provision') {
    return (
      <Card className="mx-auto max-w-sm">
        <CardHeader>
          <CardTitle>You&apos;re signed in</CardTitle>
          <CardDescription>Head to your dashboard to get started.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={() => window.location.assign('/dashboard')}>
            Go to dashboard
          </Button>
        </CardContent>
      </Card>
    );
  }

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
