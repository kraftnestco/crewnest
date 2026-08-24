import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { readInventory, readUnitCost, type OrderLine } from '@/services/inventory';
import type { DateRange } from '@/services/analytics';

export type ExpenseCategory =
  | 'general'
  | 'rent'
  | 'marketing'
  | 'shipping'
  | 'payroll'
  | 'utilities'
  | 'supplies'
  | 'other';

export interface BusinessExpense {
  id: string;
  label: string;
  amount: number;
  category: ExpenseCategory;
  expenseDate: string;
  notes: string | null;
  createdAt: string;
}

export interface ProductMarginRow {
  name: string;
  price: number | null;
  unitCost: number | null;
  margin: number | null;
  marginPct: number | null;
}

export interface FinanceSnapshot {
  cogs: number;
  operatingExpenses: number;
  netProfit: number;
  grossMarginPct: number | null;
  repeatBuyers: number;
  productMargins: ProductMarginRow[];
}

/** PostgREST when migration 0049 has not been applied yet. */
function isMissingExpensesTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST205' ||
    (typeof error.message === 'string' && error.message.includes('business_expenses'))
  );
}

function parseMoney(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = Number(String(raw).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** COGS from paid order lines × catalogue unit_cost (name match). */
export function computeCogsFromOrders(
  orders: Array<{ payment_status: string; items: unknown }>,
  catalogData: unknown,
): number {
  if (!Array.isArray(catalogData)) return 0;
  const costByName = new Map<string, number>();
  for (const raw of catalogData) {
    if (!raw || typeof raw !== 'object' || typeof (raw as { name?: unknown }).name !== 'string') continue;
    const name = (raw as { name: string }).name.trim().toLowerCase();
    const cost = readUnitCost((raw as { unit_cost?: unknown; cost?: unknown }).unit_cost ?? (raw as { cost?: unknown }).cost);
    if (cost !== null) costByName.set(name, cost);
  }
  if (costByName.size === 0) return 0;

  let cogs = 0;
  for (const order of orders) {
    if (order.payment_status !== 'paid') continue;
    if (!Array.isArray(order.items)) continue;
    for (const item of order.items) {
      if (!item || typeof item !== 'object') continue;
      const line = item as { name?: unknown; qty?: unknown };
      const name = typeof line.name === 'string' ? line.name.trim().toLowerCase() : '';
      const qty = Number(line.qty);
      const unitCost = name ? costByName.get(name) : undefined;
      if (!name || unitCost === undefined || !Number.isFinite(qty) || qty <= 0) continue;
      cogs += unitCost * qty;
    }
  }
  return cogs;
}

export function buildProductMargins(catalogData: unknown): ProductMarginRow[] {
  return readInventory(catalogData)
    .map((item) => {
      const price = parseMoney(item.price);
      const unitCost = item.unitCost;
      const margin = price !== null && unitCost !== null ? price - unitCost : null;
      const marginPct =
        margin !== null && price !== null && price > 0 ? (margin / price) * 100 : null;
      return {
        name: item.name,
        price,
        unitCost,
        margin,
        marginPct,
      };
    })
    .filter((row) => row.price !== null || row.unitCost !== null);
}

export async function listBusinessExpenses(
  tenantId: string,
  range: DateRange,
): Promise<BusinessExpense[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('business_expenses')
    .select('id, label, amount, category, expense_date, notes, created_at')
    .eq('tenant_id', tenantId)
    .gte('expense_date', range.from.slice(0, 10))
    .lte('expense_date', range.to.slice(0, 10))
    .order('expense_date', { ascending: false });

  if (error) {
    if (isMissingExpensesTable(error)) return [];
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    amount: Number(row.amount),
    category: row.category as ExpenseCategory,
    expenseDate: row.expense_date,
    notes: row.notes,
    createdAt: row.created_at,
  }));
}

export async function sumOperatingExpenses(tenantId: string, range: DateRange): Promise<number> {
  const rows = await listBusinessExpenses(tenantId, range);
  return rows.reduce((sum, row) => sum + row.amount, 0);
}

/** Repeat buyers: customers with 2+ paid orders in range (phone or external id). */
export async function countRepeatBuyers(tenantId: string, range: DateRange): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('orders')
    .select('customer_phone, external_user_id')
    .eq('tenant_id', tenantId)
    .eq('payment_status', 'paid')
    .gte('created_at', range.from)
    .lt('created_at', range.to);

  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const key =
      (row.external_user_id && String(row.external_user_id).trim()) ||
      (row.customer_phone && String(row.customer_phone).trim()) ||
      null;
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].filter((n) => n >= 2).length;
}

export async function getFinanceSnapshot(args: {
  tenantId: string;
  range: DateRange;
  netRevenue: number;
  orders: Array<{ payment_status: string; items: unknown }>;
  catalogData: unknown;
}): Promise<FinanceSnapshot> {
  const [operatingExpenses, repeatBuyers] = await Promise.all([
    sumOperatingExpenses(args.tenantId, args.range),
    countRepeatBuyers(args.tenantId, args.range),
  ]);
  const cogs = computeCogsFromOrders(args.orders, args.catalogData);
  const netProfit = args.netRevenue - cogs - operatingExpenses;
  const grossMarginPct =
    args.netRevenue > 0 && cogs > 0 ? ((args.netRevenue - cogs) / args.netRevenue) * 100 : null;

  return {
    cogs,
    operatingExpenses,
    netProfit,
    grossMarginPct,
    repeatBuyers,
    productMargins: buildProductMargins(args.catalogData),
  };
}

/** Order lines helper for inventory decrement parity. */
export function orderLinesFromItems(items: unknown): OrderLine[] {
  if (!Array.isArray(items)) return [];
  const lines: OrderLine[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const name = typeof (item as { name?: unknown }).name === 'string' ? (item as { name: string }).name : '';
    const qty = Number((item as { qty?: unknown }).qty);
    if (!name.trim() || !Number.isFinite(qty) || qty <= 0) continue;
    lines.push({ name, qty: Math.floor(qty) });
  }
  return lines;
}
