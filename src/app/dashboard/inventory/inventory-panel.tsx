'use client';

import { useState, useTransition } from 'react';
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
          orders once it sells out, and nudge you to restock. Leave an item untracked to keep it always
          available.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{tracked.length} tracked</span>
          {low > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="text-pending-text">{low} low</span>
            </>
          )}
          {out > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="text-destructive">{out} out of stock</span>
            </>
          )}
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
}: {
  item: InventoryItem;
  busy: boolean;
  onSet: (stock: number | null) => void;
  onRestock: () => void;
}) {
  const [value, setValue] = useState(item.stock === null ? '' : String(item.stock));
  const tracked = item.stock !== null;

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

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{item.name}</p>
          <StockBadge stock={item.stock} />
        </div>
        {item.price && <p className="mt-0.5 text-xs text-muted-foreground">{item.price}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
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
    </div>
  );
}
