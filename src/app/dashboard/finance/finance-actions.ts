'use server';

import { revalidatePath } from 'next/cache';
import { assertTenantAccess, getCallerContext } from '@/lib/auth/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { ExpenseCategory } from '@/services/finance';
import { log } from '@/lib/log';

function isMissingExpensesTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST205' ||
    (typeof error.message === 'string' && error.message.includes('business_expenses'))
  );
}

export interface FinanceActionResult {
  error: string | null;
  success: boolean;
}

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'general',
  'rent',
  'marketing',
  'shipping',
  'payroll',
  'utilities',
  'supplies',
  'other',
];

async function assertTenantAdmin(tenantId: string): Promise<FinanceActionResult | null> {
  const ctx = await getCallerContext();
  if (!ctx) return { error: 'Unauthorized.', success: false };
  try {
    assertTenantAccess(ctx, tenantId);
  } catch {
    return { error: 'Forbidden: tenant not accessible.', success: false };
  }
  if (!ctx.isPlatformAdmin && !ctx.memberships.some((m) => m.tenantId === tenantId && m.role === 'tenant_admin')) {
    return { error: 'Forbidden: only a tenant admin may edit finances.', success: false };
  }
  return null;
}

export async function addExpenseAction(args: {
  tenantId: string;
  label: string;
  amount: number;
  category: ExpenseCategory;
  expenseDate: string;
  notes?: string | null;
}): Promise<FinanceActionResult> {
  const denied = await assertTenantAdmin(args.tenantId);
  if (denied) return denied;

  const label = args.label.trim();
  if (!label) return { error: 'Description is required.', success: false };
  if (!Number.isFinite(args.amount) || args.amount < 0) {
    return { error: 'Amount must be zero or positive.', success: false };
  }
  if (!EXPENSE_CATEGORIES.includes(args.category)) {
    return { error: 'Invalid expense category.', success: false };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.expenseDate)) {
    return { error: 'Pick a valid date.', success: false };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('business_expenses').insert({
    tenant_id: args.tenantId,
    label,
    amount: Math.round(args.amount * 100) / 100,
    category: args.category,
    expense_date: args.expenseDate,
    notes: args.notes?.trim() || null,
  });

  if (error) {
    log.error('[finance] add expense failed', { tenantId: args.tenantId, error: error.message });
    if (isMissingExpensesTable(error)) {
      return {
        error: 'Finance tables are not set up yet. Apply migration 0049_business_finance.sql to your Supabase project.',
        success: false,
      };
    }
    return { error: error.message, success: false };
  }

  revalidatePath('/dashboard/finance');
  revalidatePath('/dashboard');
  return { error: null, success: true };
}

export async function deleteExpenseAction(tenantId: string, expenseId: string): Promise<FinanceActionResult> {
  const denied = await assertTenantAdmin(tenantId);
  if (denied) return denied;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('business_expenses')
    .delete()
    .eq('id', expenseId)
    .eq('tenant_id', tenantId);

  if (error) {
    log.error('[finance] delete expense failed', { tenantId, expenseId, error: error.message });
    return { error: error.message, success: false };
  }

  revalidatePath('/dashboard/finance');
  revalidatePath('/dashboard');
  return { error: null, success: true };
}
