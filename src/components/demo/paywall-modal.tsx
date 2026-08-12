'use client';

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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className={cn(displayFont.className, 'text-xl')}>Keep this AI for your business</DialogTitle>
          <DialogDescription>Pick a plan to create your account, and we&apos;ll set up the tenant from what you just built.</DialogDescription>
        </DialogHeader>
        {/* Four tiers — 2-up then 4-up (was sm:grid-cols-3 for three plans). */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PAYWALL_PLANS.map((plan) => (
            <Card
              key={plan.id}
              className={cn(
                'relative overflow-visible',
                plan.highlight && 'ring-2 ring-primary shadow-lg sm:-my-1 sm:scale-[1.03]',
              )}
            >
              {plan.highlight && (
                <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2">Popular</Badge>
              )}
              <CardHeader>
                <CardTitle className="text-base">{plan.name}</CardTitle>
                <p className="text-lg font-semibold">{plan.price}</p>
                <CardDescription>{plan.tagline}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {plan.features.map((f) => (
                    <li key={f}>• {f}</li>
                  ))}
                </ul>
                <Button className="w-full" size="sm" variant={plan.id === 'free' ? 'outline' : 'default'} onClick={() => onSelectPlan(plan)}>
                  {plan.id === 'free' ? 'Start free' : `Choose ${plan.name}`}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
