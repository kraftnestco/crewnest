import { NextResponse } from 'next/server';
import { pricingCurrencyForCountry } from '@/lib/pricing-currency';

/**
 * Lightweight geo for marketing / client plan cards.
 * Uses Vercel's `x-vercel-ip-country` when present; otherwise USD.
 */
export async function GET(req: Request) {
  const country = req.headers.get('x-vercel-ip-country');
  const currency = pricingCurrencyForCountry(country);
  return NextResponse.json({ country: country ?? null, currency });
}
