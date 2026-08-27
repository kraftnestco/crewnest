'use client';

import { useEffect, useState } from 'react';
import type { PricingCurrency } from '@/lib/pricing-currency';

/**
 * Client-side pricing currency for surfaces that can't read request headers
 * (paywall modal, onboarding). Defaults to USD until `/api/geo` resolves.
 */
export function usePricingCurrency(initial?: PricingCurrency): PricingCurrency {
  const [currency, setCurrency] = useState<PricingCurrency>(initial ?? 'USD');

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    fetch('/api/geo')
      .then((r) => r.json())
      .then((data: { currency?: PricingCurrency }) => {
        if (!cancelled && (data.currency === 'USD' || data.currency === 'PKR')) {
          setCurrency(data.currency);
        }
      })
      .catch(() => {
        /* keep USD */
      });
    return () => {
      cancelled = true;
    };
  }, [initial]);

  return currency;
}
