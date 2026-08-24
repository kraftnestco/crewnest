'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import type { BusinessExpense, ExpenseCategory, ProductMarginRow } from '@/services/finance';
import { addExpenseAction, deleteExpenseAction } from './finance-actions';

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  general: 'General',
  rent: 'Rent',
  marketing: 'Marketing',
  shipping: 'Shipping',
  payroll: 'Payroll',
  utilities: 'Utilities',
  supplies: 'Supplies',
  other: 'Other',
};

function formatMoney(amount: number, currency: string | null): string {
  const code = currency && currency.length === 3 ? currency.toUpperCase() : null;
  if (code) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(
        amount,
      );
    } catch {
      // fall through
    }
  }
  return amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function FinancePanel({
  tenantId,
  expenses,
  productMargins,
  currency,
}: {
  tenantId: string;
  expenses: BusinessExpense[];
  productMargins: ProductMarginRow[];
  currency: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('general');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');

  function submitExpense() {
    const parsed = Number(amount);
    if (!label.trim()) {
      toast.error('Enter a description.');
      return;
    }
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error('Enter a valid amount.');
      return;
    }
    startTransition(async () => {
      const res = await addExpenseAction({
        tenantId,
        label: label.trim(),
        amount: parsed,
        category,
        expenseDate,
        notes: notes.trim() || null,
      });
      if (res.error) toast.error(res.error);
      else {
        toast.success('Expense added.');
        setLabel('');
        setAmount('');
        setNotes('');
        router.refresh();
      }
    });
  }

  function removeExpense(id: string) {
    startTransition(async () => {
      const res = await deleteExpenseAction(tenantId, id);
      if (res.error) toast.error(res.error);
      else {
        toast.success('Expense removed.');
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 p-4">
          <div>
            <h2 className="text-sm font-semibold">Add business expense</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Rent, ads, shipping labels, packaging — anything that eats into profit besides product cost.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="expense-label">Description</Label>
              <Input
                id="expense-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Meta ads, shop rent, courier…"
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expense-amount">Amount</Label>
              <Input
                id="expense-amount"
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expense-date">Date</Label>
              <Input
                id="expense-date"
                type="date"
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expense-category">Category</Label>
              <select
                id="expense-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                disabled={pending}
                className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-2 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
              >
                {(Object.keys(CATEGORY_LABELS) as ExpenseCategory[]).map((key) => (
                  <option key={key} value={key}>
                    {CATEGORY_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="expense-notes">Notes (optional)</Label>
              <Input
                id="expense-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={pending}
              />
            </div>
          </div>
          <Button onClick={submitExpense} disabled={pending}>
            {pending ? 'Saving…' : 'Add expense'}
          </Button>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-2 text-sm font-semibold">Recent expenses</h2>
        {expenses.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No expenses logged in this period yet.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="divide-y p-0">
              {expenses.map((expense) => (
                <div key={expense.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{expense.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {expense.expenseDate} · {CATEGORY_LABELS[expense.category]}
                      {expense.notes ? ` · ${expense.notes}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums">
                      {formatMoney(expense.amount, currency)}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 text-muted-foreground"
                      onClick={() => removeExpense(expense.id)}
                      disabled={pending}
                      aria-label={`Remove ${expense.label}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Product margins</h2>
          <Button size="sm" variant="outline" render={<Link href="/dashboard/inventory" />}>
            Edit stock costs
          </Button>
        </div>
        {productMargins.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Add unit costs on your catalogue items in My Stock to see margin per product.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="divide-y p-0">
              {productMargins.map((row) => (
                <div key={row.name} className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <p className="min-w-0 truncate text-sm font-medium">{row.name}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {row.price !== null && <span>Sell {formatMoney(row.price, currency)}</span>}
                    {row.unitCost !== null && <span>Cost {formatMoney(row.unitCost, currency)}</span>}
                    {row.marginPct !== null && (
                      <span className={row.marginPct >= 30 ? 'text-emerald-600' : ''}>
                        Margin {row.marginPct.toFixed(0)}%
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
