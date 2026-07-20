'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { IntakeWizard } from '@/components/intake/intake-wizard';
import type { IntakeTenant } from '@/components/intake/intake-shared';
import { DemoChat } from '@/components/demo/demo-chat';
import { PaywallModal } from '@/components/demo/paywall-modal';
import { parseDemoIntakeFormData } from '@/services/demo/parseIntakeFormData';
import type { DemoTenantInput } from '@/services/demo/schema';
import type { PlanOption } from '@/services/demo/plans';
import { DEMO_HANDOFF_KEY, type DemoHandoff } from '@/services/demo/handoff';

/**
 * Public demo funnel orchestrator (docs: "try it for your business" plan,
 * Phase B): wizard -> soft email capture -> live chat. The email-capture
 * submit both checks the per-IP rate limit and (best-effort) records a
 * `demo_leads` row via /api/demo/start — see migration 0026.
 */

const BLANK_TENANT: IntakeTenant = {
  id: 'demo',
  system_prompt: '',
  catalog_data: {},
  catalog_freeform_text: '',
  custom_orders_enabled: false,
  custom_orders_require_approval: true,
  custom_order_instructions: null,
  media_handling: 'match_catalogue',
  business_type: 'product',
  booking_link: null,
  knowledge_base: null,
  business_hours: null,
  timezone: null,
  payments_enabled: false,
  payment_methods: [],
  payment_instructions: null,
  default_currency: '',
  prepaid_required: false,
};

type Phase = 'intake' | 'email' | 'blocked' | 'chat';

function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function TryDemo() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('intake');
  const [pendingFormData, setPendingFormData] = useState<FormData | null>(null);
  const [email, setEmail] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [gateSubmitting, setGateSubmitting] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);
  const [demoTenant, setDemoTenant] = useState<DemoTenantInput | null>(null);
  const [paywallOpen, setPaywallOpen] = useState(false);

  function handleSelectPlan(plan: PlanOption) {
    // The 'blocked' phase never ran parseDemoIntakeFormData (that only happens
    // on a successful /api/demo/start), so build it here from what's already
    // been collected rather than requiring another round trip.
    const tenant = demoTenant ?? (pendingFormData ? parseDemoIntakeFormData(pendingFormData, businessName.trim() || 'Your business') : null);
    if (!tenant) return;
    const handoff: DemoHandoff = { demoTenant: tenant, planId: plan.id, email };
    sessionStorage.setItem(DEMO_HANDOFF_KEY, JSON.stringify(handoff));
    router.push(`/signup?plan=${plan.id}&email=${encodeURIComponent(email)}`);
  }

  function handleIntakeFinish(fd: FormData) {
    setPendingFormData(fd);
    setPhase('email');
  }

  async function handleUnlockChat() {
    setGateError(null);
    if (!isValidEmail(email)) {
      setGateError('Enter a valid email so we can follow up if you want the real thing.');
      return;
    }
    if (!businessName.trim()) {
      setGateError('Enter your business name.');
      return;
    }
    if (!pendingFormData) {
      setGateError('Something went wrong — please restart the demo.');
      return;
    }

    setGateSubmitting(true);
    try {
      const tenant = parseDemoIntakeFormData(pendingFormData, businessName.trim());
      const res = await fetch('/api/demo/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, demoTenant: tenant }),
      });
      const data = await res.json().catch(() => ({ allowed: false }));
      if (!res.ok || !data.allowed) {
        setPhase('blocked');
        return;
      }
      setDemoTenant(tenant);
      setPhase('chat');
    } catch {
      setGateError('Something went wrong — please try again.');
    } finally {
      setGateSubmitting(false);
    }
  }

  if (phase === 'intake') {
    return <IntakeWizard tenant={BLANK_TENANT} onFinish={handleIntakeFinish} finishLabel="See your AI in action" />;
  }

  if (phase === 'email') {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle>Almost there</CardTitle>
          <CardDescription>
            Where should we send the link if you want to keep this AI for real? We won&apos;t email you anything else.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="demo_business_name">Business name</Label>
            <Input
              id="demo_business_name"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Zara's Bakery"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="demo_email">Email</Label>
            <Input
              id="demo_email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@business.com"
            />
          </div>
          {gateError && <p className="text-sm text-destructive">{gateError}</p>}
          <Button className="w-full" onClick={handleUnlockChat} disabled={gateSubmitting}>
            {gateSubmitting ? 'Starting…' : 'Chat with your AI'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (phase === 'blocked') {
    return (
      <>
        <Card className="mx-auto max-w-md">
          <CardHeader>
            <CardTitle>You&apos;ve used today&apos;s demo sessions</CardTitle>
            <CardDescription>
              Come back tomorrow for another free look, or set this up for real right now.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => setPaywallOpen(true)}>
              Get it for real
            </Button>
          </CardContent>
        </Card>
        <PaywallModal open={paywallOpen} onOpenChange={setPaywallOpen} onSelectPlan={handleSelectPlan} />
      </>
    );
  }

  if (!demoTenant) return null;
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setPaywallOpen(true)}>Get it for real</Button>
      </div>
      <DemoChat demoTenant={demoTenant} businessName={businessName.trim() || 'Your business'} />
      <PaywallModal open={paywallOpen} onOpenChange={setPaywallOpen} onSelectPlan={handleSelectPlan} />
    </div>
  );
}
