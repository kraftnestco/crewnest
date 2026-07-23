import type { Json } from '@/types/database';

/**
 * Inventory Lite (docs/19 I1). Stock rides INSIDE each `catalog_data` item as an
 * optional numeric `stock` field — no new table, no variants, no warehouses. A
 * missing/invalid `stock` means the item is simply not tracked (always
 * available); `stock: 0` means sold out. This module is the single source of
 * truth for reading and transforming that field, and is deliberately PURE (no
 * DB, no `server-only`) so the prompt builder, the dashboard page, and the order
 * tool can all share the exact same interpretation. Actual writes live in
 * `inventoryStore.ts` (service-role) and the dashboard actions (RLS-scoped).
 */

/** Items at or below this (and still > 0) are "low" — fires the restock nudge. */
export const LOW_STOCK_THRESHOLD = 3;

export interface InventoryItem {
  name: string;
  description: string | null;
  price: string | null;
  /** null = not tracked (treated as always available); >= 0 = units on hand. */
  stock: number | null;
}

/** One line of an order/quote, reduced to what stock cares about. */
export interface OrderLine {
  name: string;
  qty: number;
}

/** A stock transition worth telling the owner about. */
export interface StockEvent {
  name: string;
  previous: number;
  next: number;
  /** Hit zero on this order. */
  outOfStock: boolean;
  /** Newly crossed into the low band (was above threshold, now at/below but > 0). */
  low: boolean;
}

export interface DecrementResult {
  /** The catalogue with matched, tracked items decremented. */
  catalog: Json;
  /** Transitions that crossed into low/out — the notify-worthy subset. */
  events: StockEvent[];
  /** True when any item's stock actually changed. */
  changed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Coerce a raw `stock` field into a non-negative integer, or null when untracked/invalid. */
export function readStock(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.floor(raw));
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
    return Math.max(0, Math.floor(Number(raw)));
  }
  return null;
}

function readPrice(raw: unknown): string | null {
  if (typeof raw === 'string' && raw.trim() !== '') return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return null;
}

/**
 * Normalise `catalog_data` (the array-of-items shape) into inventory rows. Items
 * without a usable name are skipped; a non-array catalogue (legacy object form)
 * yields [] — the inventory UI simply shows nothing to track for those tenants.
 */
export function readInventory(catalogData: unknown): InventoryItem[] {
  if (!Array.isArray(catalogData)) return [];
  const items: InventoryItem[] = [];
  for (const raw of catalogData) {
    if (!isRecord(raw) || typeof raw.name !== 'string' || !raw.name.trim()) continue;
    items.push({
      name: raw.name,
      description: typeof raw.description === 'string' ? raw.description : null,
      price: readPrice(raw.price),
      stock: readStock(raw.stock),
    });
  }
  return items;
}

/** True when at least one catalogue item tracks stock — gates the prompt rule + UI affordances. */
export function catalogHasStockTracking(catalogData: unknown): boolean {
  if (!Array.isArray(catalogData)) return false;
  return catalogData.some((raw) => isRecord(raw) && readStock(raw.stock) !== null);
}

/**
 * Return a new catalogue with the named item's `stock` set (or cleared with
 * null → stops tracking it). Exact name match, case-insensitive and trimmed.
 * Items that don't match are returned untouched, so a mistyped name never edits
 * the wrong product.
 */
export function setStockInCatalog(catalogData: unknown, name: string, stock: number | null): Json {
  if (!Array.isArray(catalogData)) return (catalogData as Json) ?? [];
  const target = name.trim().toLowerCase();
  const next = catalogData.map((raw) => {
    if (!isRecord(raw) || typeof raw.name !== 'string' || raw.name.trim().toLowerCase() !== target) return raw;
    const copy: Record<string, unknown> = { ...raw };
    if (stock === null) delete copy.stock;
    else copy.stock = Math.max(0, Math.floor(stock));
    return copy;
  });
  // Controlled boundary: the input came from a Json column, so the transformed
  // array is still JSON-serialisable.
  return next as unknown as Json;
}

/**
 * Decrement tracked stock for each order line, matching by item name
 * (case-insensitive, trimmed, exact). Untracked items (stock null) and lines
 * that match no catalogue item are left alone — the tool never guesses which
 * product an unmatched line refers to. Floors at 0. Returns the new catalogue
 * plus the low/out transitions worth notifying on.
 */
export function applyOrderDecrements(catalogData: unknown, lines: OrderLine[]): DecrementResult {
  if (!Array.isArray(catalogData)) {
    return { catalog: (catalogData as Json) ?? [], events: [], changed: false };
  }

  // Aggregate requested quantity per (lowercased) name so a repeated line sums.
  const wanted = new Map<string, number>();
  for (const line of lines) {
    const key = line.name.trim().toLowerCase();
    if (!key || !Number.isFinite(line.qty) || line.qty <= 0) continue;
    wanted.set(key, (wanted.get(key) ?? 0) + Math.floor(line.qty));
  }
  if (wanted.size === 0) return { catalog: catalogData as Json, events: [], changed: false };

  const events: StockEvent[] = [];
  let changed = false;
  const next = catalogData.map((raw) => {
    if (!isRecord(raw) || typeof raw.name !== 'string') return raw;
    const qty = wanted.get(raw.name.trim().toLowerCase());
    const current = readStock(raw.stock);
    if (qty === undefined || current === null) return raw; // not ordered, or untracked
    const updated = Math.max(0, current - qty);
    if (updated === current) return raw;
    changed = true;
    events.push({
      name: raw.name,
      previous: current,
      next: updated,
      outOfStock: updated === 0,
      low: current > LOW_STOCK_THRESHOLD && updated <= LOW_STOCK_THRESHOLD && updated > 0,
    });
    return { ...raw, stock: updated };
  });

  return { catalog: next as unknown as Json, events, changed };
}
