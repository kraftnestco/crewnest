/** ISO codes collected at signup so billing can route Pakistan → Safepay. */
export const SIGNUP_COUNTRY_OPTIONS = [
  { code: 'PK', label: 'Pakistan' },
  { code: 'AE', label: 'United Arab Emirates' },
  { code: 'SA', label: 'Saudi Arabia' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'US', label: 'United States' },
  { code: 'CA', label: 'Canada' },
  { code: 'AU', label: 'Australia' },
  { code: 'IN', label: 'India' },
  { code: 'OTHER', label: 'Somewhere else' },
] as const;

export function normalizeBillingCountry(raw: string | null | undefined): string | null {
  const value = raw?.trim().toUpperCase();
  if (!value) return null;
  if (value === 'OTHER') return 'OTHER';
  if (/^[A-Z]{2}$/.test(value)) return value;
  return null;
}
