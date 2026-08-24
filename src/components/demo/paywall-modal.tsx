'use client';

import { Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { displayFont } from '@/app/_landing/fonts';
import { PAYWALL_PLANS, type PlanOption } from '@/services/demo/plans';

/**
 * Plan-selection paywall (docs: "try it for your business" plan, Phase C).
 * Triggered on demo-cap exhaustion or a "Get it for real" click. Selecting a
 * plan hands off to self-serve signup — no billing happens here; paid plans
 * are provisioned `pending_upgrade` and the agency is notified.
 *
 * Card chrome matches the marketing `#pricing` section so the handoff from
 * landing → /try doesn't feel like a different product.
 */
export function PaywallModal({
  open,
  onOpenChange,
  onSelectPlan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectPlan: (plan: PlanOption) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(92vh,52rem)] gap-6 overflow-y-auto sm:max-w-6xl">
        <DialogHeader className="text-center sm:text-center">
          <DialogTitle className={cn(displayFont.className, 'text-2xl tracking-tight text-balance')}>
            Keep this AI for your business
          </DialogTitle>
          <DialogDescription className="text-balance">
            Pick a plan to create your account, and we&apos;ll set up the tenant from what you just built.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          {PAYWALL_PLANS.map((plan) => {
            const highlighted = Boolean(plan.highlight);
            return (
              <div key={plan.id} className="relative h-full">
                {highlighted && (
                  <Badge className="absolute -top-2.5 left-1/2 z-10 -translate-x-1/2 border-transparent bg-pending-tint text-pending-text">
                    Most popular
                  </Badge>
                )}
                <Card className={cn('flex h-full flex-col', highlighted && 'shadow-lg ring-primary/40')}>
                  <CardHeader className="pb-3">
                    <CardTitle className={cn(displayFont.className, 'font-semibold')}>{plan.name}</CardTitle>
                    <p className={cn(displayFont.className, 'text-3xl font-semibold tracking-tight')}>
                      {plan.price}
                    </p>
                    <CardDescription className="text-pretty">{plan.tagline}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col justify-between gap-6 pt-0">
                    <ul className="flex flex-col gap-2.5">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-sm text-foreground/85">
                          <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    <Button
                      className="w-full"
                      variant={highlighted ? 'default' : 'outline'}
                      onClick={() => onSelectPlan(plan)}
                    >
                      {plan.id === 'free' ? 'Start free' : `Start with ${plan.name}`}
                    </Button>
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
