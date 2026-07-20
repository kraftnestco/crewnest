'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  createOrderFromSummaryAction,
  generateOrderSummaryAction,
  type OrderSummaryDraft,
} from '@/app/admin/chat/order-summary-actions';
import type { OrderItem, PaymentMethod } from '@/types/domain';

const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cod: 'Cash on delivery',
  manual_transfer: 'Bank/manual transfer',
  gateway: 'Online payment',
};

const EMPTY_DRAFT: OrderSummaryDraft = { items: [], customerName: '', customerPhone: '', customerAddress: '', notes: '' };

/**
 * Human-confirmed order continuation after a handoff conversation (docs: order-event-messaging
 * plan, Phase D) — an AI-drafted, editable order the business owner explicitly reviews and
 * submits. Never writes on its own; "Create order" is the only path that persists anything.
 */
export function OrderSummaryDialog({ sessionId, paymentMethods }: { sessionId: string; paymentMethods: PaymentMethod[] }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<OrderSummaryDraft>(EMPTY_DRAFT);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('');
  const [isSubmitting, startSubmitting] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setLoading(true);
      setDraft(EMPTY_DRAFT);
      setPaymentMethod('');
      generateOrderSummaryAction(sessionId)
        .then(setDraft)
        .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to generate order summary.'))
        .finally(() => setLoading(false));
    }
  }

  function updateItem(index: number, patch: Partial<OrderItem>) {
    setDraft((d) => ({ ...d, items: d.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) }));
  }

  function removeItem(index: number) {
    setDraft((d) => ({ ...d, items: d.items.filter((_, i) => i !== index) }));
  }

  function addItem() {
    setDraft((d) => ({ ...d, items: [...d.items, { name: '', qty: 1 }] }));
  }

  function handleCreate() {
    startSubmitting(async () => {
      try {
        await createOrderFromSummaryAction(sessionId, { ...draft, paymentMethod: paymentMethod || null });
        toast.success('Order created.');
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to create order.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button type="button" variant="outline" size="sm" onClick={() => handleOpenChange(true)}>
        Order summary
      </Button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Order summary</DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Drafting from the conversation…</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Items</Label>
              {draft.items.length === 0 && (
                <p className="text-xs text-muted-foreground">No items drafted yet — add one below.</p>
              )}
              {draft.items.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={item.name}
                    onChange={(e) => updateItem(i, { name: e.target.value })}
                    placeholder="Item name"
                    aria-label="Item name"
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    min={1}
                    value={item.qty}
                    onChange={(e) => updateItem(i, { qty: Math.max(1, Number(e.target.value) || 1) })}
                    aria-label="Quantity"
                    className="w-16"
                  />
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(i)}>
                    Remove
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addItem}>
                Add item
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="order-summary-name">Customer name</Label>
                <Input
                  id="order-summary-name"
                  value={draft.customerName}
                  onChange={(e) => setDraft((d) => ({ ...d, customerName: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="order-summary-phone">Phone</Label>
                <Input
                  id="order-summary-phone"
                  value={draft.customerPhone}
                  onChange={(e) => setDraft((d) => ({ ...d, customerPhone: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="order-summary-address">Address</Label>
              <Input
                id="order-summary-address"
                value={draft.customerAddress}
                onChange={(e) => setDraft((d) => ({ ...d, customerAddress: e.target.value }))}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="order-summary-notes">Notes</Label>
              <Textarea
                id="order-summary-notes"
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                rows={2}
              />
            </div>

            {paymentMethods.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="order-summary-payment">Payment method</Label>
                <select
                  id="order-summary-payment"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod | '')}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="">Not decided yet</option>
                  {paymentMethods.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABEL[m] ?? m}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" onClick={handleCreate} disabled={loading || isSubmitting || draft.items.length === 0}>
            {isSubmitting ? 'Creating…' : 'Create order'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
