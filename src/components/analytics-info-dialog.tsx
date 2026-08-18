'use client';

import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

const SHARED_METRICS = [
  ['Conversations started', 'New customer conversations opened during the selected period.'],
  ['Deflection rate', 'Share of conversations the AI handled without a human takeover.'],
  ['Handoff rate', 'Share of conversations that were not fully deflected and needed human help.'],
  ['Orders / bookings secured', 'Confirmed or fulfilled orders plus booked appointments created during the period.'],
  ['Payment conversion', 'Paid orders divided by confirmed or fulfilled orders created during the period.'],
  ['CSAT', 'Average customer rating on fulfilled orders; shown after at least five reviews.'],
  ['Sentiment health', 'Current mix of clear, frustrated, price, product, and cancellation signals in active chats.'],
] as const;

const CLIENT_ONLY = [
  ['Messages handled', 'Assistant replies sent during the selected period, including staff replies stored as assistant messages.'],
] as const;

const ADMIN_ONLY = [
  ['Cost (BYOK / platform)', 'Estimated LLM spend split between client-owned keys and ClerkNest platform keys.'],
  ['By client', 'Client-level conversation volume, deflection, and cost for comparison and unit-economics review.'],
] as const;

export function AnalyticsInfoDialog({ audience }: { audience: 'client' | 'admin' }) {
  const metrics = audience === 'client' ? [...SHARED_METRICS, ...CLIENT_ONLY] : [...SHARED_METRICS, ...ADMIN_ONLY];

  return (
    <Dialog>
      {/*
        Viewport FAB — Button folds className through cva and drops `fixed`,
        so the wrapper owns positioning. Offset clears the in-flow mobile tab
        bar; desktop clears the w-56 sidebar.
      */}
      <div className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-4 z-30 lg:bottom-6 lg:left-[calc(14rem+1.5rem)]">
        <DialogTrigger
          render={
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="size-11 rounded-full bg-card shadow-lg"
              aria-label="Explain analytics"
              title="Explain analytics"
            />
          }
        >
          <Info className="size-4" />
        </DialogTrigger>
      </div>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">What these analytics mean</DialogTitle>
          <DialogDescription>
            All figures use the date range selected at the top of this page.
          </DialogDescription>
        </DialogHeader>
        <div className="mx-3 border-t-2 border-border" aria-hidden />
        <dl className="space-y-3">
          {metrics.map(([name, explanation]) => (
            <div key={name}>
              <dt className="text-sm font-medium text-foreground">{name}</dt>
              <dd className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{explanation}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
