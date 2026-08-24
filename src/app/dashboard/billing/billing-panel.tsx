'use client';

import { useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { displayFont } from '@/app/_landing/fonts';
import { createCheckoutSessionAction, createPortalLinkAction, cancelSubscriptionAction } from './actions';
import { type PlanOption } from '@/services/demo/plans';
import type { BillingProviderId } from '@/types/domain';
import { isPaidPlanId, planRank, type PaidPlanId } from '@/lib/entitlements';

export function BillingPanel({
  tenantId,
  currentPlan,
  planStatus,
  plans,
  billingProvider,
  hasSubscription,
}: {
  tenantId: string;
  currentPlan: string;
  planStatus: string | null;
  plans: PlanOption[];
  billingProvider: BillingProviderId;
  hasSubscription: boolean;
}) {
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Safepay has no hosted customer portal, so those tenants cancel in-app.
  const isSafepay = billingProvider === 'safepay';

  async function handleCancel() {
    if (!window.confirm('Cancel your subscription? You’ll move to the Free plan at the end of your billing period.')) {
      return;
    }
    setCancelling(true);
    try {
      const result = await cancelSubscriptionAction(tenantId);
      if (result.ok) {
        toast.success('Cancellation requested. Your plan updates once it’s confirmed.');
        return;
      }
      toast.error(result.error ?? "Couldn't cancel your subscription.");
    } finally {
      setCancelling(false);
    }
  }

  async function handleChoosePlan(plan: PlanOption) {
    if (plan.contactSales || plan.id === 'free' || plan.id === currentPlan) return;
    if (!isPaidPlanId(plan.id)) return;
    setPendingPlan(plan.id);
    try {
      const result = await createCheckoutSessionAction(tenantId, plan.id as PaidPlanId);
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      toast.error(result.error ?? "Couldn't start checkout.");
    } finally {
      setPendingPlan(null);
    }
  }

  async function handleManageBilling() {
    setOpeningPortal(true);
    try {
      const result = await createPortalLinkAction(tenantId);
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      toast.error(result.error ?? "Couldn't open billing management.");
    } finally {
      setOpeningPortal(false);
    }
  }

  return (
    <div className="space-y-6">
      {planStatus === 'payment_failed' && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Payment failed</p>
            <p className="text-xs">We couldn&apos;t charge your card. Update your payment method to keep your plan active.</p>
          </div>
        </div>
      )}

      {currentPlan !== 'free' && (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="text-sm font-normal text-muted-foreground">Manage subscription</CardTitle>
          </CardHeader>
          <CardContent>
            {isSafepay ? (
              <>
                <p className="mb-3 text-sm text-muted-foreground">
                  To change your payment method, cancel and resubscribe. Cancelling moves you to the Free
                  plan at the end of your current billing period.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCancel}
                  disabled={cancelling || !hasSubscription}
                >
                  {cancelling ? 'Cancelling…' : 'Cancel subscription'}
                </Button>
              </>
            ) : (
              <>
                <p className="mb-3 text-sm text-muted-foreground">
                  Update your payment method, view invoices, or cancel your subscription.
                </p>
                <Button size="sm" variant="outline" onClick={handleManageBilling} disabled={openingPortal}>
                  {openingPortal ? 'Opening…' : 'Manage billing'}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Card chrome matches marketing #pricing / paywall — five tiers including Enterprise. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {plans.map((plan) => {
          const isCurrent = plan.id === currentPlan;
          const highlighted = Boolean(plan.highlight);
          const isDowngrade = planRank(plan.id) < planRank(currentPlan);
          const price = isSafepay ? (plan.pricePkr ?? plan.price) : plan.price;
          const showCheckout = isPaidPlanId(plan.id) && !isCurrent;
          return (
            <div key={plan.id} className="relative h-full">
              {isCurrent && (
                <Badge className="absolute -top-2.5 left-1/2 z-10 -translate-x-1/2">Current plan</Badge>
              )}
              {!isCurrent && highlighted && (
                <Badge className="absolute -top-2.5 left-1/2 z-10 -translate-x-1/2 border-transparent bg-pending-tint text-pending-text">
                  Most popular
                </Badge>
              )}
              <Card
                className={cn(
                  'flex h-full flex-col',
                  isCurrent && 'ring-2 ring-primary',
                  !isCurrent && highlighted && 'shadow-lg ring-primary/40',
                )}
              >
                <CardHeader className="pb-3">
                  <CardTitle className={cn(displayFont.className, 'font-semibold')}>{plan.name}</CardTitle>
                  <p className={cn(displayFont.className, 'text-3xl font-semibold tracking-tight')}>{price}</p>
                  <CardDescription className="text-pretty">{plan.tagline}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col justify-between gap-6 pt-0">
                  <ul className="flex flex-col gap-2.5">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-foreground/85">
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  {showCheckout && (
                    <Button
                      className="w-full"
                      variant={highlighted && !isDowngrade ? 'default' : 'outline'}
                      onClick={() => handleChoosePlan(plan)}
                      disabled={pendingPlan !== null}
                    >
                      {pendingPlan === plan.id
                        ? 'Redirecting…'
                        : isDowngrade
                          ? `Switch to ${plan.name}`
                          : `Choose ${plan.name}`}
                    </Button>
                  )}
                </CardContent>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}
