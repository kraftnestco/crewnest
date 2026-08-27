/**
 * Pricing currency for display (not checkout amount conversion).
 * Pakistan visitors/tenants see fixed PKR labels; everyone else sees USD.
 * Safepay still bills pre-created PKR plans — this only chooses which string to show.
 */

export type PricingCurrency = 'USD' | 'PKR';

/** True when this country should see PKR prices. */
export function isPakistanCountry(country: string | null | undefined): boolean {
  return (country ?? '').trim().toUpperCase() === 'PK';
}

export function pricingCurrencyForCountry(country: string | null | undefined): PricingCurrency {
  return isPakistanCountry(country) ? 'PKR' : 'USD';
}
