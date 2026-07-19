'use client';

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/page-header';
import { StatusLegend, ORDER_STATUS_LEGEND } from '@/components/status-legend';
import type { Database } from '@/types/database';
import type { OrderAttachment } from '@/types/domain';
import {
  approveOrderAction,
  fulfillOrderAction,
  getOrderMediaUrlAction,
  getOrdersPageAction,
  markPaidAction,
  markRefundedAction,
  rejectOrderAction,
  rejectPaymentProofAction,
  type OrderRow,
  type OrderStatus,
} from './actions';

type PaymentStatus = Database['public']['Enums']['payment_status'];

const PAYMENT_STATUS_BADGE: Record<PaymentStatus, 'default' | 'outline' | 'secondary' | 'destructive'> = {
  unpaid: 'outline',
  awaiting_verification: 'secondary',
  paid: 'default',
  refunded: 'secondary',
  failed: 'destructive',
};

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cod: 'COD',
  manual_transfer: 'Transfer',
  gateway: 'Online',
};

type TenantRow = Pick<Database['public']['Tables']['tenants']['Row'], 'id' | 'business_name'>;

const STATUS_FILTERS: Array<{ value: OrderStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'fulfilled', label: 'Fulfilled' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_BADGE: Record<OrderStatus, 'default' | 'outline' | 'secondary' | 'destructive'> = {
  pending: 'outline',
  confirmed: 'default',
  fulfilled: 'secondary',
  cancelled: 'destructive',
};

function itemsSummary(items: unknown): string {
  if (!Array.isArray(items)) return '—';
  return items
    .map((i) => {
      const item = i as { name?: string; qty?: number };
      return `${item.name ?? '?'} ×${item.qty ?? 1}`;
    })
    .join(', ');
}

type OrderItemLike = { name?: string; qty?: number; customization?: string };

/** Approval-queue detail panel — items[].customization, notes, contact details, media (forward-compat). */
function PendingOrderDetail({
  order,
  onDone,
}: {
  order: OrderRow;
  onDone: (message: string, isError?: boolean) => void;
}) {
  const [reason, setReason] = useState('');
  const [isActing, startActing] = useTransition();
  const items = (Array.isArray(order.items) ? order.items : []) as OrderItemLike[];
  const attachments = (order.attachments as unknown as OrderAttachment[] | null) ?? [];

  function handleApprove() {
    startActing(async () => {
      try {
        await approveOrderAction(order.id);
        onDone('Order approved.');
      } catch (err) {
        onDone(err instanceof Error ? err.message : 'Failed to approve order.', true);
      }
    });
  }

  function handleReject() {
    startActing(async () => {
      try {
        await rejectOrderAction(order.id, reason);
        onDone('Order rejected.');
      } catch (err) {
        onDone(err instanceof Error ? err.message : 'Failed to reject order.', true);
      }
    });
  }

  return (
    <div className="space-y-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Requested items</p>
          <ul className="mt-1 space-y-1 text-sm">
            {items.map((item, i) => (
              <li key={i}>
                {item.name ?? '?'} ×{item.qty ?? 1}
                {item.customization && (
                  <span className="block text-xs text-muted-foreground">Customisation: {item.customization}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Contact</p>
          <p className="mt-1 text-sm">{order.customer_name || '—'}</p>
          <p className="text-sm text-muted-foreground">{order.customer_phone || '—'}</p>
          <p className="text-sm text-muted-foreground">{order.customer_address || '—'}</p>
        </div>
      </div>
      {order.notes && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Notes</p>
          <p className="text-sm">{order.notes}</p>
        </div>
      )}
      {attachments.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Media ({attachments.length})</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <OrderAttachmentPreview key={a.storagePath} orderId={order.id} attachment={a} />
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button size="sm" onClick={handleApprove} disabled={isActing} title="Confirm this order and notify the customer">
          Approve
        </Button>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for rejecting (optional)"
          aria-label="Reason for rejecting"
          className="max-w-xs"
          disabled={isActing}
        />
        <Button
          size="sm"
          variant="destructive"
          onClick={handleReject}
          disabled={isActing}
          title="Decline this order and notify the customer"
        >
          Reject
        </Button>
      </div>
    </div>
  );
}

/** Manual close-out for a confirmed order/service — no external fulfillment signal exists yet, so this is owner-driven. */
function FulfillAction({
  orderId,
  onDone,
}: {
  orderId: string;
  onDone: (message: string, isError?: boolean) => void;
}) {
  const [isActing, startActing] = useTransition();

  function handleFulfill() {
    startActing(async () => {
      try {
        await fulfillOrderAction(orderId);
        onDone('Order marked as fulfilled.');
      } catch (err) {
        onDone(err instanceof Error ? err.message : 'Failed to mark fulfilled.', true);
      }
    });
  }

  return (
    <Button size="sm" variant="outline" onClick={handleFulfill} disabled={isActing}>
      Mark fulfilled
    </Button>
  );
}

/** Fetches a short-TTL signed URL for one order attachment and renders it by kind (docs/10 §4/§5/§6.1). */
function OrderAttachmentPreview({ orderId, attachment }: { orderId: string; attachment: OrderAttachment }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    getOrderMediaUrlAction(orderId, attachment.storagePath)
      .then((signedUrl) => {
        if (active) {
          if (signedUrl) setUrl(signedUrl);
          else setFailed(true);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [orderId, attachment.storagePath]);

  if (failed) return <p className="text-xs italic text-muted-foreground">Media unavailable.</p>;
  if (!url) return <p className="text-xs text-muted-foreground">Loading media…</p>;

  if (attachment.kind === 'image') {
    // eslint-disable-next-line @next/next/no-img-element -- signed URL, not an optimizable static asset
    return <img src={url} alt="Order attachment" className="max-h-32 rounded-lg object-contain" />;
  }
  if (attachment.kind === 'audio') {
    return <audio controls src={url} className="h-8 max-w-full" />;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="text-xs underline underline-offset-2">
      View video
    </a>
  );
}

/** Payment badge + method/amount + owner actions (docs/11 §3.5/§5) — Mark paid/refunded, Verify/Reject proof. */
function PaymentCell({
  order,
  onDone,
}: {
  order: OrderRow;
  onDone: (message: string, isError?: boolean) => void;
}) {
  const [isActing, startActing] = useTransition();
  const proof = order.payment_proof as unknown as OrderAttachment | null;

  function handleMarkPaid() {
    startActing(async () => {
      try {
        await markPaidAction(order.id);
        onDone('Order marked as paid.');
      } catch (err) {
        onDone(err instanceof Error ? err.message : 'Failed to mark paid.', true);
      }
    });
  }

  function handleMarkRefunded() {
    startActing(async () => {
      try {
        await markRefundedAction(order.id);
        onDone('Order marked as refunded.');
      } catch (err) {
        onDone(err instanceof Error ? err.message : 'Failed to mark refunded.', true);
      }
    });
  }

  function handleReject() {
    startActing(async () => {
      try {
        await rejectPaymentProofAction(order.id);
        onDone('Payment proof rejected.');
      } catch (err) {
        onDone(err instanceof Error ? err.message : 'Failed to reject payment proof.', true);
      }
    });
  }

  return (
    <div className="space-y-1">
      <Badge variant={PAYMENT_STATUS_BADGE[order.payment_status]} className="capitalize">
        {order.payment_status.replace('_', ' ')}
      </Badge>
      {order.payment_method && (
        <div className="text-xs text-muted-foreground">
          {PAYMENT_METHOD_LABEL[order.payment_method] ?? order.payment_method}
          {order.amount_total !== null && ` · ${order.currency ?? ''} ${order.amount_total}`}
        </div>
      )}
      {proof && (
        <div className="max-w-[8rem]">
          <OrderAttachmentPreview orderId={order.id} attachment={proof} />
        </div>
      )}
      <div className="flex flex-wrap gap-1 pt-0.5">
        {order.payment_status === 'unpaid' && (
          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={handleMarkPaid} disabled={isActing}>
            Mark paid
          </Button>
        )}
        {order.payment_status === 'awaiting_verification' && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              onClick={handleMarkPaid}
              disabled={isActing}
              title="Confirm the submitted payment proof is valid"
            >
              Verify
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              onClick={handleReject}
              disabled={isActing}
              title="Reject the submitted payment proof and ask the customer to resubmit"
            >
              Reject
            </Button>
          </>
        )}
        {order.payment_status === 'paid' && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            onClick={handleMarkRefunded}
            disabled={isActing}
          >
            Mark refunded
          </Button>
        )}
      </div>
    </div>
  );
}

export function OrdersView({
  initialOrders,
  tenants,
  realtimeAccessToken,
  showBusinessColumn = true,
  chatBasePath = '/admin/chat',
  initialStatus = 'all',
}: {
  initialOrders: OrderRow[];
  tenants: TenantRow[];
  realtimeAccessToken: string | null;
  /** Hide the "Business" column for a single-tenant view (docs/13 §8). */
  showBusinessColumn?: boolean;
  /** Base path for the "View chat" deep link — differs between the agency and tenant dashboards. */
  chatBasePath?: string;
  /** Pre-filter from a `?status=` deep link (docs/14 §5.1 "Needs attention" cards); the server already fetched a matching first page. */
  initialStatus?: OrderStatus | 'all';
}) {
  const columnCount = showBusinessColumn ? 10 : 9;
  const [orders, setOrders] = useState(initialOrders);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>(initialStatus);
  const [hasMore, setHasMore] = useState(initialOrders.length === 25);
  const [isPending, startTransition] = useTransition();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const statusFilterRef = useRef(statusFilter);

  const tenantMap = useMemo(() => new Map(tenants.map((t) => [t.id, t.business_name])), [tenants]);

  useEffect(() => {
    statusFilterRef.current = statusFilter;
  }, [statusFilter]);

  useEffect(() => {
    if (realtimeAccessToken) void supabase.realtime.setAuth(realtimeAccessToken);
  }, [realtimeAccessToken, supabase]);

  // Single long-lived subscription (doesn't rebind on filter change) — matches
  // an in-flight status filter via the ref so it always reads the current value.
  useEffect(() => {
    const channel = supabase
      .channel('admin-orders')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload) => {
        const row = payload.new as OrderRow;
        toast.success(`New order from ${row.customer_name || 'a customer'}`);
        const filter = statusFilterRef.current;
        if (filter !== 'all' && row.status !== filter) return;
        setOrders((prev) => (prev.some((o) => o.id === row.id) ? prev : [row, ...prev]));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, (payload) => {
        const row = payload.new as OrderRow;
        setOrders((prev) => prev.map((o) => (o.id === row.id ? row : o)));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  function handleFilterChange(next: OrderStatus | 'all') {
    setStatusFilter(next);
    startTransition(async () => {
      try {
        const page = await getOrdersPageAction({ status: next });
        setOrders(page.orders);
        setHasMore(page.hasMore);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load orders.');
      }
    });
  }

  function handleLoadMore() {
    const oldest = orders[orders.length - 1];
    if (!oldest) return;
    startTransition(async () => {
      try {
        const page = await getOrdersPageAction({ status: statusFilter, before: oldest.created_at });
        setOrders((prev) => [...prev, ...page.orders]);
        setHasMore(page.hasMore);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load more orders.');
      }
    });
  }

  function handleActionDone(message: string, isError?: boolean) {
    if (isError) toast.error(message);
    else toast.success(message);
    setExpandedId(null);
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Orders"
        description="New orders appear instantly below; scroll down for full history."
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          {STATUS_FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={statusFilter === f.value ? 'default' : 'outline'}
              onClick={() => handleFilterChange(f.value)}
              disabled={isPending}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <StatusLegend items={ORDER_STATUS_LEGEND} />
      </div>

      <div className="rounded-xl bg-card ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              {showBusinessColumn && <TableHead>Business</TableHead>}
              <TableHead>Items</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead title="Whether the business owner was alerted about this order">Owner alert</TableHead>
              <TableHead>Placed</TableHead>
              <TableHead className="text-right">Chat</TableHead>
              <TableHead className="text-right">Review</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((o) => (
              <Fragment key={o.id}>
                <TableRow>
                  <TableCell className="font-medium">
                    {o.customer_name || '—'}
                    {o.customer_phone && (
                      <div className="text-xs font-normal text-muted-foreground">{o.customer_phone}</div>
                    )}
                  </TableCell>
                  {showBusinessColumn && <TableCell>{tenantMap.get(o.tenant_id) ?? 'Unknown'}</TableCell>}
                  <TableCell className="max-w-xs truncate">{itemsSummary(o.items)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[o.status]} className="capitalize">
                      {o.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <PaymentCell order={o} onDone={handleActionDone} />
                  </TableCell>
                  <TableCell className="capitalize">{o.platform ?? '—'}</TableCell>
                  <TableCell>
                    {o.owner_notified_at ? (
                      <Badge variant="secondary">Sent</Badge>
                    ) : (
                      <Badge variant="outline">Pending</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(o.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    {o.session_id ? (
                      <Link
                        href={`${chatBasePath}?session=${o.session_id}`}
                        className="text-xs text-primary underline underline-offset-2"
                      >
                        View chat
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {o.status === 'pending' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setExpandedId((cur) => (cur === o.id ? null : o.id))}
                      >
                        {expandedId === o.id ? 'Close' : 'Review'}
                      </Button>
                    ) : o.status === 'confirmed' ? (
                      <FulfillAction orderId={o.id} onDone={handleActionDone} />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
                {expandedId === o.id && o.status === 'pending' && (
                  <TableRow>
                    <TableCell colSpan={columnCount} className="bg-muted/30 p-0">
                      <PendingOrderDetail order={o} onDone={handleActionDone} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
            {orders.length === 0 && (
              <TableRow>
                <TableCell colSpan={columnCount} className="py-8 text-center text-muted-foreground">
                  No orders yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={handleLoadMore} disabled={isPending}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
