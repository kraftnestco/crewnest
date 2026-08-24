'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Boxes, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { StatusPill } from '@/components/status-pill';
import { cn } from '@/lib/utils';
import { LOW_STOCK_THRESHOLD, type InventoryItem } from '@/services/inventory';
import {
  restockItemAction,
  setItemStockAction,
  setItemUnitCostAction,
  type InventoryActionResult,
} from './inventory-actions';

/** One quick-add step for the restock button. */
const RESTOCK_STEP = 10;

type StockState = 'out' | 'low' | 'in' | 'untracked';

function stockState(stock: number | null): StockState {
  if (stock === null) return 'untracked';
  if (stock === 0) return 'out';
  if (stock <= LOW_STOCK_THRESHOLD) return 'low';
  return 'in';
}

function StockBadge({ stock }: { stock: number | null }) {
  const state = stockState(stock);
  if (state === 'untracked') return <Badge variant="outline">Not tracked</Badge>;
  if (state === 'out') return <Badge variant="destructive">Out of stock</Badge>;
  if (state === 'low') {
    return <StatusPill tone="pending">Low · {stock} left</StatusPill>;
  }
  return <Badge variant="secondary">{stock} in stock</Badge>;
}

export function InventoryPanel({
  tenantId,
  items,
}: {
  tenantId: string;
  items: InventoryItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /** Which row is mid-write, so only its controls disable. */
  const [busyName, setBusyName] = useState<string | null>(null);

  function run(name: string, fn: () => Promise<InventoryActionResult>, okMessage: string) {
    setBusyName(name);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.error) toast.error(res.error);
        else {
          toast.success(okMessage);
          router.refresh(); // reconcile with the server (covers concurrent order decrements)
        }
      } catch {
        toast.error('Something went wrong. Please try again.');
      } finally {
        setBusyName(null);
      }
    });
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <Boxes className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">No catalogue items yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add products to your catalogue first, then set stock counts here.
            </p>
          </div>
          <Button size="sm" variant="outline" render={<Link href="/dashboard/business" />}>
            Go to My Business
          </Button>
        </CardContent>
      </Card>
    );
  }

  const tracked = items.filter((i) => i.stock !== null);
  const low = tracked.filter((i) => i.stock !== null && i.stock > 0 && i.stock <= LOW_STOCK_THRESHOLD).length;
  const out = tracked.filter((i) => i.stock === 0).length;

  return (
    <div className="space-y-4">
      {tracked.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Stock tracking is optional. Set a count on any item below and your assistant will stop taking
          orders once it sells out, and nudge you to restock. Add a unit cost to track true profit in Finance.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Tracked</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums">{tracked.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Low stock</p>
              <p className={`mt-0.5 text-2xl font-semibold tabular-nums ${low > 0 ? 'text-pending-text' : ''}`}>
                {low}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Out of stock</p>
              <p className={`mt-0.5 text-2xl font-semibold tabular-nums ${out > 0 ? 'text-destructive' : ''}`}>
                {out}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardContent className="divide-y p-0">
          {items.map((item) => (
            <InventoryRow
              key={item.name}
              item={item}
              busy={pending && busyName === item.name}
              onSet={(stock) =>
                run(item.name, () => setItemStockAction(tenantId, item.name, stock), stock === null ? 'Stopped tracking.' : 'Stock updated.')
              }
              onRestock={() =>
                run(item.name, () => restockItemAction(tenantId, item.name, RESTOCK_STEP), `Added ${RESTOCK_STEP}.`)
              }
              onSetCost={(cost) =>
                run(
                  item.name,
                  () => setItemUnitCostAction(tenantId, item.name, cost),
                  cost === null ? 'Cost cleared.' : 'Unit cost updated.',
                )
              }
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function InventoryRow({
  item,
  busy,
  onSet,
  onRestock,
  onSetCost,
}: {
  item: InventoryItem;
  busy: boolean;
  onSet: (stock: number | null) => void;
  onRestock: () => void;
  onSetCost: (cost: number | null) => void;
}) {
  const [value, setValue] = useState(item.stock === null ? '' : String(item.stock));
  const [costValue, setCostValue] = useState(item.unitCost === null ? '' : String(item.unitCost));
  const tracked = item.stock !== null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync controlled draft from props after server mutation
    setValue(item.stock === null ? '' : String(item.stock));
  }, [item.stock]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync controlled draft from props after server mutation
    setCostValue(item.unitCost === null ? '' : String(item.unitCost));
  }, [item.unitCost]);

  function commit() {
    const trimmed = value.trim();
    if (trimmed === '') {
      toast.error('Enter a stock number, or use “Stop tracking”.');
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) {
      toast.error('Stock must be zero or a positive whole number.');
      return;
    }
    onSet(Math.floor(n));
  }

  function commitCost() {
    const trimmed = costValue.trim();
    if (trimmed === '') {
      onSetCost(null);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) {
      toast.error('Unit cost must be zero or a positive number.');
      return;
    }
    onSetCost(n);
  }

  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{item.name}</p>
          <StockBadge stock={item.stock} />
        </div>
        {item.price && <p className="mt-0.5 text-xs text-muted-foreground">Sell: {item.price}</p>}
        {item.unitCost !== null && (
          <p className="mt-0.5 text-xs text-muted-foreground">Cost: {item.unitCost}</p>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:items-end">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Stock</span>
        <Input
          type="number"
          min={0}
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          disabled={busy}
          placeholder="—"
          aria-label={`Stock for ${item.name}`}
          className="h-8 w-20"
        />
        <Button size="sm" variant="outline" onClick={commit} disabled={busy}>
          {tracked ? 'Set' : 'Track'}
        </Button>
        {tracked && (
          <Button size="sm" variant="ghost" onClick={onRestock} disabled={busy} title={`Add ${RESTOCK_STEP}`}>
            <Plus className="h-3.5 w-3.5" />
            {RESTOCK_STEP}
          </Button>
        )}
        {tracked && (
          <Button
            size="sm"
            variant="ghost"
            className={cn('text-muted-foreground')}
            onClick={() => onSet(null)}
            disabled={busy}
          >
            Stop tracking
          </Button>
        )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Unit cost</span>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={costValue}
            onChange={(e) => setCostValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitCost();
              }
            }}
            disabled={busy}
            placeholder="—"
            aria-label={`Unit cost for ${item.name}`}
            className="h-8 w-24"
          />
          <Button size="sm" variant="outline" onClick={commitCost} disabled={busy}>
            Set cost
          </Button>
        </div>
      </div>
    </div>
  );
}
