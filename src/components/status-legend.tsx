/**
 * Small colored-dot legend, reused in Orders (order status) and the Inbox
 * (alert_signal) so the color coding is never a mystery (docs/14 §7.1). The dot
 * colors here are the legend's own vocabulary — they don't have to match a
 * badge `variant`, only stay consistent with themselves across screens.
 */
export function StatusLegend({ items }: { items: ReadonlyArray<{ label: string; dotClassName: string }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={`h-2 w-2 rounded-full ${item.dotClassName}`} />
          {item.label}
        </div>
      ))}
    </div>
  );
}

export const ORDER_STATUS_LEGEND = [
  { label: 'Pending', dotClassName: 'bg-amber-500' },
  { label: 'Confirmed', dotClassName: 'bg-primary' },
  { label: 'Fulfilled', dotClassName: 'bg-emerald-500' },
  { label: 'Cancelled', dotClassName: 'bg-destructive' },
] as const;

export const ALERT_SIGNAL_LEGEND = [
  { label: 'Frustrated', dotClassName: 'bg-amber-500' },
  { label: 'Price objection', dotClassName: 'bg-sky-500' },
  { label: 'Product doubt', dotClassName: 'bg-violet-500' },
  { label: 'Cancellation risk', dotClassName: 'bg-destructive' },
] as const;
