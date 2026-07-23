import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { notifyBoth } from './notifications';
import { applyOrderDecrements, type OrderLine } from './inventory';
import type { Tenant } from '@/types/domain';

/**
 * Inventory Lite (docs/19 I1) — the service-role write half. Runs in the
 * unauthenticated AI-turn/webhook context (the order tool + the admin approve
 * action), so it MUST use the service client; the RLS-scoped dashboard edits
 * live in the inventory server actions instead.
 *
 * A read-modify-write on the JSON catalogue: two orders confirming in the same
 * instant could each read the pre-decrement value and under-count by one. That
 * race is accepted for "lite" stock (no variants, no ledger); the owner sees the
 * true count on the Inventory page and can correct it in one tap.
 *
 * NOTE: the low-stock notification uses type `'low_stock'`, which the
 * `notifications_type_check` constraint only allows once the parked inventory
 * migration is applied. Until then `notify()` swallows the constraint error
 * (it is best-effort) — stock still decrements; only the bell/email is deferred.
 */
export async function applyOrderStockEffects(
  tenant: Pick<Tenant, 'id' | 'businessName'>,
  lines: OrderLine[],
): Promise<void> {
  const svc = createServiceClient();

  const { data, error } = await svc.from('tenants').select('catalog_data').eq('id', tenant.id).single();
  if (error || !data) throw error ?? new Error('Tenant not found for stock decrement.');

  const { catalog, events, changed } = applyOrderDecrements(data.catalog_data, lines);
  if (!changed) return;

  const { error: updErr } = await svc.from('tenants').update({ catalog_data: catalog }).eq('id', tenant.id);
  if (updErr) throw updErr;

  const outNames = events.filter((e) => e.outOfStock).map((e) => e.name);
  const lowNames = events.filter((e) => e.low).map((e) => `${e.name} (${e.next} left)`);
  if (outNames.length === 0 && lowNames.length === 0) return;

  const body = [
    outNames.length ? `Out of stock: ${outNames.join(', ')}` : null,
    lowNames.length ? `Low stock: ${lowNames.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('. ');

  await notifyBoth({
    tenantId: tenant.id,
    type: 'low_stock',
    entityType: null,
    entityId: null,
    agency: { title: `Stock alert — ${tenant.businessName}`, body, link: '/admin/clients' },
    tenant: { title: 'Stock running low', body, link: '/dashboard/inventory' },
  });
}
