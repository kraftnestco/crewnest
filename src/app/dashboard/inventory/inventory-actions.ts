'use server';

import { revalidatePath } from 'next/cache';
import { assertTenantAccess, getCallerContext } from '@/lib/auth/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { readInventory, setStockInCatalog, setUnitCostInCatalog } from '@/services/inventory';
import { log } from '@/lib/log';

/**
 * Inventory Lite (docs/19 I1) — the tenant-facing write half. Unlike the
 * order-path decrement (service-role, in `inventoryStore.ts`), these run in an
 * authenticated dashboard request, so every write goes through the RLS-scoped
 * client — the same tenant-admin-only path `updateIntakeAction` uses. The read
 * doubles as the access check.
 *
 * Stock is treated as a live, read-direct field: the prompt grounds on
 * `catalog_data` directly (stuff mode) so an edit is visible on the very next
 * turn without re-embedding. We deliberately do NOT re-embed here — matching the
 * order-path decrement, which is the higher-frequency writer — so retrieve-mode
 * chunks may lag on the exact count. That's an accepted "lite" limitation.
 */

export interface InventoryActionResult {
  error: string | null;
  success: boolean;
}

/** Shared tenant-admin guard, identical to updateIntakeAction (docs/13 §9). */
async function assertTenantAdmin(tenantId: string): Promise<InventoryActionResult | null> {
  const ctx = await getCallerContext();
  if (!ctx) return { error: 'Unauthorized.', success: false };
  try {
    assertTenantAccess(ctx, tenantId);
  } catch {
    return { error: 'Forbidden: tenant not accessible.', success: false };
  }
  if (!ctx.isPlatformAdmin && !ctx.memberships.some((m) => m.tenantId === tenantId && m.role === 'tenant_admin')) {
    return { error: 'Forbidden: only a tenant admin may edit inventory.', success: false };
  }
  return null;
}

/** Read the tenant's catalogue through the RLS client (also the access check). */
async function readCatalog(tenantId: string): Promise<{ catalog: unknown } | { error: string }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from('tenants').select('catalog_data').eq('id', tenantId).single();
  if (error || !data) return { error: error?.message ?? 'Tenant not found.' };
  return { catalog: data.catalog_data };
}

/**
 * Set an item's stock to an absolute value, or clear tracking with `null`.
 * Covers all three UI affordances: start tracking (a number), edit the count,
 * and stop tracking (null). Name match is exact/case-insensitive in
 * `setStockInCatalog`, so an unknown name is a no-op rather than a wrong edit.
 */
export async function setItemStockAction(
  tenantId: string,
  name: string,
  stock: number | null,
): Promise<InventoryActionResult> {
  const denied = await assertTenantAdmin(tenantId);
  if (denied) return denied;

  const trimmed = name.trim();
  if (!trimmed) return { error: 'Item name is required.', success: false };
  if (stock !== null && (!Number.isFinite(stock) || stock < 0)) {
    return { error: 'Stock must be zero or a positive whole number.', success: false };
  }

  const read = await readCatalog(tenantId);
  if ('error' in read) return { error: read.error, success: false };

  const next = setStockInCatalog(read.catalog, trimmed, stock === null ? null : Math.floor(stock));

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('tenants').update({ catalog_data: next }).eq('id', tenantId);
  if (error) {
    log.error('[inventory] set stock failed', { tenantId, error: error.message });
    return { error: error.message, success: false };
  }

  revalidatePath('/dashboard/inventory');
  revalidatePath('/dashboard/finance');
  return { error: null, success: true };
}

/**
 * One-tap restock — add `addUnits` to the current count, computed server-side
 * (read-modify-write) so a stale client value can't clobber a concurrent
 * decrement. An untracked item starts tracking at `addUnits`.
 */
export async function restockItemAction(
  tenantId: string,
  name: string,
  addUnits: number,
): Promise<InventoryActionResult> {
  const denied = await assertTenantAdmin(tenantId);
  if (denied) return denied;

  const trimmed = name.trim();
  if (!trimmed) return { error: 'Item name is required.', success: false };
  if (!Number.isFinite(addUnits) || addUnits <= 0) {
    return { error: 'Restock amount must be a positive whole number.', success: false };
  }

  const read = await readCatalog(tenantId);
  if ('error' in read) return { error: read.error, success: false };

  const target = trimmed.toLowerCase();
  const current = readInventory(read.catalog).find((i) => i.name.trim().toLowerCase() === target);
  if (!current) return { error: 'That item is no longer in your catalogue.', success: false };

  const next = setStockInCatalog(read.catalog, trimmed, (current.stock ?? 0) + Math.floor(addUnits));

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('tenants').update({ catalog_data: next }).eq('id', tenantId);
  if (error) {
    log.error('[inventory] restock failed', { tenantId, error: error.message });
    return { error: error.message, success: false };
  }

  revalidatePath('/dashboard/inventory');
  revalidatePath('/dashboard/finance');
  return { error: null, success: true };
}

/** Set per-unit cost on a catalogue item, or clear with null. */
export async function setItemUnitCostAction(
  tenantId: string,
  name: string,
  unitCost: number | null,
): Promise<InventoryActionResult> {
  const denied = await assertTenantAdmin(tenantId);
  if (denied) return denied;

  const trimmed = name.trim();
  if (!trimmed) return { error: 'Item name is required.', success: false };
  if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0)) {
    return { error: 'Unit cost must be zero or positive.', success: false };
  }

  const read = await readCatalog(tenantId);
  if ('error' in read) return { error: read.error, success: false };

  const next = setUnitCostInCatalog(read.catalog, trimmed, unitCost);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('tenants').update({ catalog_data: next }).eq('id', tenantId);
  if (error) {
    log.error('[inventory] set unit cost failed', { tenantId, error: error.message });
    return { error: error.message, success: false };
  }

  revalidatePath('/dashboard/inventory');
  revalidatePath('/dashboard/finance');
  return { error: null, success: true };
}
