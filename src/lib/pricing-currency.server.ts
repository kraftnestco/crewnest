import { headers } from 'next/headers';
import { pricingCurrencyForCountry, type PricingCurrency } from '@/lib/pricing-currency';

/**
 * Resolve display currency from the request's geo header (Vercel sets
 * `x-vercel-ip-country`). Falls back to USD when unknown (local dev, non-Vercel).
 */
export async function resolveRequestPricingCurrency(): Promise<PricingCurrency> {
  const h = await headers();
  const country = h.get('x-vercel-ip-country');
  return pricingCurrencyForCountry(country);
}
