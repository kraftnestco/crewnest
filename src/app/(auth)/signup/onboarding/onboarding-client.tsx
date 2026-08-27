'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { displayFont } from '@/app/_landing/fonts';
import { Logomark } from '@/app/_landing/logomark';
import { IntakeWizard } from '@/components/intake/intake-wizard';
import type { IntakeTenant } from '@/components/intake/intake-shared';
import { PAYWALL_PLANS, planPriceLabel, type PlanOption } from '@/services/demo/plans';
import { BILLING_COUNTRY_KEY } from '@/services/demo/handoff';
import { isPaidPlanId } from '@/lib/entitlements';
import { pricingCurrencyForCountry } from '@/lib/pricing-currency';
import { usePricingCurrency } from '@/hooks/use-pricing-currency';
import { provisionFromIntakeAction } from './provision-from-intake-action';
import { createCheckoutSessionAction } from '@/app/dashboard/billing/actions';
import { signOutAction } from '@/app/admin/actions';

const EMPTY_TENANT: IntakeTenant = {
  id: '',
  system_prompt: '',
  catalog_data: {},
  catalog_freeform_text: null,
  custom_orders_enabled: false,
  custom_orders_require_approval: false,
  custom_order_instructions: null,
  media_handling: 'match_catalogue',
  voice_handling: 'human_review',
  business_type: 'product',
  booking_link: null,
  booking_enabled: false,
  booking_mode: null,
  booking_own_link: null,
  booking_duration_minutes: 30,
  booking_lead_time_minutes: 120,
  booking_max_days_ahead: 30,
  knowledge_base: null,
  business_hours: null,
  timezone: null,
  payments_enabled: false,
  payment_methods: [],
  payment_instructions: null,
  default_currency: 'PKR',
  prepaid_required: false,
};

function formDataToRecord(fd: FormData): Record<string, string | string[]> {
  const obj: Record<string, string | string[]> = {};
  fd.forEach((value, key) => {
    if (typeof value !== 'string') return;
    if (key in obj) {
      const existing = obj[key];
      obj[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      obj[key] = value;
    }
  });
  return obj;
}

export function OnboardingClient() {
  const [phase, setPhase] = useState<'intake' | 'plan'>('intake');
  const [businessName, setBusinessName] = useState('');
  const [storedFields, setStoredFields] = useState<Record<string, string | string[]> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const geoCurrency = usePricingCurrency();
  const [sessionCurrency, setSessionCurrency] = useState<ReturnType<typeof pricingCurrencyForCountry> | null>(
    null,
  );
  const currency = sessionCurrency ?? geoCurrency;

  useEffect(() => {
    const country = sessionStorage.getItem(BILLING_COUNTRY_KEY);
    if (country) setSessionCurrency(pricingCurrencyForCountry(country));
  }, []);

  function handleWizardFinish(fd: FormData) {
    if (!businessName.trim()) {
      setError('Enter your business name first, then finish the form.');
      nameRef.current?.focus();
      return;
    }
    setError(null);
    setStoredFields(formDataToRecord(fd));
    setPhase('plan');
  }

  async function handleSelectPlan(plan: PlanOption) {
    if (!storedFields) {
      setPhase('intake');
      return;
    }
    setProvisioning(true);
    setProvisionError(null);
    const billingCountry = sessionStorage.getItem(BILLING_COUNTRY_KEY);
    const result = await provisionFromIntakeAction({
      businessName,
      intakeFields: storedFields,
      planId: plan.id,
      billingCountry,
    });
    if (result.error) {
      setProvisionError(result.error);
      setProvisioning(false);
      return;
    }
    // Paid plan -> real Stripe/Safepay checkout (mirrors CompleteClient). The
    // tenant is already on 'free' with plan_status='pending_upgrade'; the
    // webhook clears it once payment completes, so an abandoned checkout
    // correctly stays pending, not silently free.
    if (result.planStatus === 'pending_upgrade' && result.tenantId && isPaidPlanId(plan.id)) {
      const checkout = await createCheckoutSessionAction(result.tenantId, plan.id);
      if (checkout.url) {
        window.location.assign(checkout.url);
        return;
      }
      window.location.assign('/dashboard');
      return;
    }
    // Hard navigation so /dashboard's server-side auth check sees the session.
    window.location.assign('/dashboard');
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <Logomark className="size-7" />
            <span className="font-logo text-lg">ClerkNest</span>
          </div>
          <form action={signOutAction}>
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6">
        <div className="mb-6">
          <h1 className={cn(displayFont.className, 'text-2xl tracking-tight text-balance')}>
            Set up your AI employee
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Answer a few questions about your business. We&apos;ll build your assistant from your answers.
          </p>
        </div>

        {/* Intake phase: business name + wizard. Kept mounted (via `hidden`,
            not unmounted) when phase==='plan' so Back from plan preserves the
            wizard's in-progress state. */}
        <div className={phase === 'intake' ? 'space-y-4' : 'hidden'}>
          <Card>
            <CardHeader>
              <CardTitle>What&apos;s your business called?</CardTitle>
              <CardDescription>
                This is the name your AI employee will use when talking to customers.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Input
                ref={nameRef}
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="e.g. KraftNest Bakery"
                className="h-10"
              />
              {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
            </CardContent>
          </Card>
          <IntakeWizard
            tenant={EMPTY_TENANT}
            onFinish={handleWizardFinish}
            finishLabel="Continue to plan"
          />
        </div>

        {phase === 'plan' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Pick a plan</h2>
              <p className="text-sm text-muted-foreground">
                Start free and upgrade anytime, or pick a paid plan now.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {PAYWALL_PLANS.map((plan) => (
                <Card
                  key={plan.id}
                  className={cn('relative overflow-visible', plan.highlight && 'ring-2 ring-primary shadow-lg')}
                >
                  {plan.highlight && (
                    <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2">Popular</Badge>
                  )}
                  <CardHeader>
                    <CardTitle className="text-base">{plan.name}</CardTitle>
                    <p className="text-lg font-semibold">{planPriceLabel(plan, currency)}</p>
                    <CardDescription>{plan.tagline}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {plan.features.map((f) => (
                        <li key={f}>• {f}</li>
                      ))}
                    </ul>
                    <Button
                      className="w-full"
                      size="sm"
                      variant={plan.id === 'free' ? 'outline' : 'default'}
                      disabled={provisioning}
                      onClick={() => handleSelectPlan(plan)}
                    >
                      {provisioning ? 'Setting up…' : plan.id === 'free' ? 'Start free' : `Choose ${plan.name}`}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
            {provisionError && <p className="text-sm text-destructive">{provisionError}</p>}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={provisioning}
              onClick={() => setPhase('intake')}
            >
              Back to form
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
