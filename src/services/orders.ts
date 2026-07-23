import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { ORDER_DEDUPE_WINDOW_MINUTES, ORDER_CAP_WINDOW_MINUTES, PROOF_MATCH_WINDOW_HOURS } from '@/lib/constants';
import type { Database, Json } from '@/types/database';
import type {
  Order,
  OrderAttachment,
  OrderItem,
  OrderStatus,
  OrderStatusEvent,
  PaymentMethod,
  PaymentStatus,
  Platform,
} from '@/types/domain';

/**
 * Orders persistence + idempotency/abuse helpers for the create_order tool.
 * Service-role only — writes are never exposed to the authenticated/RLS path
 * (matches usage_logs; see docs/09-ORDERS-AND-TOOLS.md §3.2).
 */

type OrderRow = Database['public']['Tables']['orders']['Row'];

function mapOrder(row: OrderRow): Order {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sessionId: row.session_id,
    status: row.status,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerAddress: row.customer_address,
    items: (row.items as unknown as OrderItem[]) ?? [],
    notes: row.notes,
    platform: row.platform,
    externalUserId: row.external_user_id,
    ownerNotifiedAt: row.owner_notified_at,
    attachments: (row.attachments as unknown as OrderAttachment[] | null) ?? null,
    paymentStatus: row.payment_status,
    paymentMethod: row.payment_method as PaymentMethod | null,
    paymentProvider: row.payment_provider,
    paymentReference: row.payment_reference,
    amountTotal: row.amount_total,
    currency: row.currency,
    paidAt: row.paid_at,
    paymentProof: (row.payment_proof as unknown as OrderAttachment | null) ?? null,
    statusHistory: (row.status_history as unknown as OrderStatusEvent[]) ?? [],
    reviewRating: row.review_rating,
    reviewText: row.review_text,
    reviewRequestedAt: row.review_requested_at,
    reviewSubmittedAt: row.review_submitted_at,
    piiErasedAt: row.pii_erased_at,
    createdAt: row.created_at,
  };
}

export interface CreateOrderInput {
  tenantId: string;
  sessionId: string | null;
  platform: Platform | null;
  externalUserId: string | null;
  items: OrderItem[];
  customerName?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  notes?: string | null;
  /** Server-decided (docs/10 §3.3) — never model-supplied. Defaults to 'confirmed' (existing behaviour). */
  status?: OrderStatus;
  /** Server-bound from the turn's downloaded media — never model-supplied (docs/10 §4.3). */
  attachments?: OrderAttachment[] | null;
  /** Server-resolved (docs/11 §3.3) — never model-supplied. Null when payments are disabled/no method resolves. */
  paymentMethod?: PaymentMethod | null;
  /** Server-computed advisory total (docs/11 §3.3.1) — null unless every item has a numeric price. */
  amountTotal?: number | null;
  currency?: string | null;
}

/**
 * Normalise items + customer identity + media into a comparable fingerprint for
 * dedupe. Includes attachment storage paths (docs/10 §8) so a retried delivery of
 * the same media (with the same collected details) doesn't double-insert.
 */
export function computeFingerprint(
  items: OrderItem[],
  customer: { name?: string | null; phone?: string | null; address?: string | null },
  attachments?: OrderAttachment[] | null,
): string {
  const normalizedItems = items
    .map((i) => `${i.name.trim().toLowerCase()}x${i.qty}`)
    .sort()
    .join('|');
  const normalizedCustomer = [customer.name, customer.phone, customer.address]
    .map((v) => (v ?? '').trim().toLowerCase())
    .join('|');
  const normalizedMedia = (attachments ?? [])
    .map((a) => a.storagePath)
    .sort()
    .join('|');
  return `${normalizedItems}::${normalizedCustomer}::${normalizedMedia}`;
}

/** Abuse cap: how many orders this session has placed within the cap window. */
export async function countRecentForSession(sessionId: string): Promise<number> {
  const client = createServiceClient();
  const since = new Date(Date.now() - ORDER_CAP_WINDOW_MINUTES * 60_000).toISOString();
  const { count, error } = await client
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .gte('created_at', since);

  if (error) throw error;
  return count ?? 0;
}

/**
 * Atomically checks-for-duplicate and inserts in one DB transaction (migration
 * 0021). Previously the duplicate check (recentDuplicate) and the insert
 * (create) were two separate Supabase calls — each its own implicit
 * transaction — so two near-simultaneous create_order tool calls for the same
 * session (e.g. a customer double-sending their confirmation) could both pass
 * the check before either insert committed, producing duplicate orders and
 * duplicate owner notifications. `create_order_atomic` serializes concurrent
 * calls per session_id via a Postgres advisory lock and checks the
 * already-computed fingerprint against a stored column, so the normalisation
 * logic in computeFingerprint isn't duplicated in SQL.
 */
export async function createDeduped(
  input: CreateOrderInput,
  fingerprint: string,
): Promise<{ order: Order | null; duplicate: boolean }> {
  const client = createServiceClient();
  const { data, error } = await client.rpc('create_order_atomic', {
    p_tenant_id: input.tenantId,
    p_session_id: input.sessionId,
    p_platform: input.platform,
    p_external_user_id: input.externalUserId,
    p_items: input.items as unknown as Json,
    p_customer_name: input.customerName ?? null,
    p_customer_phone: input.customerPhone ?? null,
    p_customer_address: input.customerAddress ?? null,
    p_notes: input.notes ?? null,
    p_status: input.status ?? 'confirmed',
    p_attachments: (input.attachments ?? null) as unknown as Json,
    p_payment_method: input.paymentMethod ?? null,
    p_amount_total: input.amountTotal ?? null,
    p_currency: input.currency ?? null,
    p_fingerprint: fingerprint,
    p_dedupe_window_minutes: ORDER_DEDUPE_WINDOW_MINUTES,
  });

  if (error) throw error;

  const result = data as unknown as { is_duplicate: boolean } & Partial<OrderRow>;
  if (result.is_duplicate) return { order: null, duplicate: true };
  return { order: mapOrder(result as OrderRow), duplicate: false };
}

/** Mark the owner WhatsApp push as delivered (best-effort; never blocks the customer reply). */
export async function markOwnerNotified(orderId: string): Promise<void> {
  const client = createServiceClient();
  const { error } = await client
    .from('orders')
    .update({ owner_notified_at: new Date().toISOString() })
    .eq('id', orderId);

  if (error) throw error;
}

/**
 * Approve/reject writes are service-role only, like every other write here (migration
 * 0009's comment: no authenticated write policy on `orders`). The RLS-authenticated
 * read that gates access happens in the caller (admin/orders/actions.ts), mirroring
 * `manualSendAction`'s "read-as-access-check" pattern — see docs/10 §3.4.
 */
export async function approve(orderId: string): Promise<Order> {
  const client = createServiceClient();
  const { data, error } = await client
    .from('orders')
    .update({ status: 'confirmed' })
    .eq('id', orderId)
    .select()
    .single();

  if (error) throw error;
  return mapOrder(data);
}

export async function reject(orderId: string, notes?: string | null): Promise<Order> {
  const client = createServiceClient();
  const { data, error } = await client
    .from('orders')
    .update({ status: 'cancelled', ...(notes !== undefined ? { notes } : {}) })
    .eq('id', orderId)
    .select()
    .single();

  if (error) throw error;
  return mapOrder(data);
}

/** Owner dashboard action: manually mark a confirmed order/service as done; seeds the post-fulfillment review ask. */
export async function fulfill(orderId: string): Promise<Order> {
  const client = createServiceClient();
  const { data, error } = await client
    .from('orders')
    .update({ status: 'fulfilled', review_requested_at: new Date().toISOString() })
    .eq('id', orderId)
    .select()
    .single();

  if (error) throw error;
  return mapOrder(data);
}

/**
 * Append-only status/payment transition log (docs: order-event-messaging plan,
 * Phase A). Read-modify-write since supabase-js has no `jsonb ||` update
 * expression — acceptable here as these calls are sequential, human-triggered
 * dashboard actions, not high-concurrency writes.
 */
export async function appendStatusEvent(orderId: string, event: string): Promise<void> {
  const client = createServiceClient();
  const { data: current, error: readError } = await client
    .from('orders')
    .select('status_history')
    .eq('id', orderId)
    .single();
  if (readError) throw readError;

  const history = (current.status_history as unknown as OrderStatusEvent[]) ?? [];
  const next = [...history, { event, at: new Date().toISOString() }];

  const { error } = await client
    .from('orders')
    .update({ status_history: next as unknown as Json })
    .eq('id', orderId);
  if (error) throw error;
}

/**
 * Customer-facing review submission (submit_review tool). Callers must have
 * already verified `session.pendingReviewOrderId` matches `orderId` and belongs
 * to the calling tenant — this function trusts its caller, like `edit`/`cancel`.
 */
export async function submitReview(orderId: string, rating: number, text: string | null): Promise<Order> {
  const client = createServiceClient();
  const { data, error } = await client
    .from('orders')
    .update({
      review_rating: rating,
      review_text: text,
      review_submitted_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .select()
    .single();

  if (error) throw error;
  return mapOrder(data);
}

/**
 * Session-scoped order lookup for the check_order_status tool. Identity is
 * server-bound (session id only) — never accepts a tenant/customer id from the
 * model, so one conversation can never enumerate another customer's orders.
 */
export async function listForSession(sessionId: string, limit = 5): Promise<Order[]> {
  const client = createServiceClient();
  const { data, error } = await client
    .from('orders')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map(mapOrder);
}

export async function getById(orderId: string): Promise<Order | null> {
  const client = createServiceClient();
  const { data, error } = await client.from('orders').select('*').eq('id', orderId).maybeSingle();

  if (error) throw error;
  return data ? mapOrder(data) : null;
}

/**
 * docs/11 §4.2 guard: only pending/confirmed orders are editable/cancellable by
 * the customer — fulfilled/cancelled orders are terminal. `payment_status` isn't
 * in the schema yet (doc 11 Stage J); once it ships, extend this to also block a
 * `paid` order (refund becomes a human/Stage-L action, per the full guard table).
 */
const OPEN_STATUSES: OrderStatus[] = ['pending', 'confirmed'];

export function isEditable(order: Pick<Order, 'status'>): boolean {
  return OPEN_STATUSES.includes(order.status);
}

/** Resolve the edit_order/cancel_order target: an explicit id, or the session's most recent editable order. */
export async function findEditableForSession(sessionId: string, orderId?: string): Promise<Order | null> {
  const recent = await listForSession(sessionId);
  if (orderId) return recent.find((o) => o.id === orderId) ?? null;
  return recent.find((o) => isEditable(o)) ?? null;
}

/**
 * K1 proof-vs-example image routing (docs/11 §3.3.1 B) — session-scoped, never
 * model/caption-driven. The most recent open, unpaid manual-transfer order in this
 * session with no proof attached yet, within PROOF_MATCH_WINDOW_HOURS.
 */
export async function findProofTarget(sessionId: string): Promise<Order | null> {
  const client = createServiceClient();
  const since = new Date(Date.now() - PROOF_MATCH_WINDOW_HOURS * 60 * 60_000).toISOString();
  const { data, error } = await client
    .from('orders')
    .select('*')
    .eq('session_id', sessionId)
    .eq('payment_method', 'manual_transfer')
    .eq('payment_status', 'unpaid')
    .in('status', OPEN_STATUSES)
    .is('payment_proof', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapOrder(data) : null;
}

export interface EditOrderInput {
  items?: OrderItem[];
  customerName?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  notes?: string | null;
  /** Server-decided re-approval (docs/11 §4.3) — never model-supplied. */
  status?: OrderStatus;
}

export async function edit(orderId: string, patch: EditOrderInput): Promise<Order> {
  const client = createServiceClient();
  const update: Database['public']['Tables']['orders']['Update'] = {};
  if (patch.items !== undefined) update.items = patch.items as unknown as Json;
  if (patch.customerName !== undefined) update.customer_name = patch.customerName;
  if (patch.customerPhone !== undefined) update.customer_phone = patch.customerPhone;
  if (patch.customerAddress !== undefined) update.customer_address = patch.customerAddress;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.status !== undefined) update.status = patch.status;

  const { data, error } = await client.from('orders').update(update).eq('id', orderId).select().single();
  if (error) throw error;
  return mapOrder(data);
}

/** Customer-initiated cancel (docs/11 §4.2) — reuses reject's write, merging `reason` into existing notes. */
export async function cancel(orderId: string, reason?: string | null): Promise<Order> {
  const current = await getById(orderId);
  const mergedNotes = reason
    ? [current?.notes, `Cancelled by customer: ${reason}`].filter(Boolean).join(' | ')
    : (current?.notes ?? null);
  return reject(orderId, mergedNotes);
}

/**
 * K1 (docs/11 §3.3.1 B): attach a payment-proof media reference and flip the order
 * into `awaiting_verification` in one write — the orchestrator's proof-routing branch
 * never sets `paid` itself, only a human/webhook can (docs/11 §1.1).
 */
export async function attachProof(orderId: string, proof: OrderAttachment): Promise<Order> {
  const client = createServiceClient();
  const { data, error } = await client
    .from('orders')
    .update({
      payment_proof: proof as unknown as Json,
      payment_status: 'awaiting_verification',
    })
    .eq('id', orderId)
    .select()
    .single();

  if (error) throw error;
  return mapOrder(data);
}

/** Server/webhook-only status transition (docs/11 §1.1) — never called from model-facing tool code. */
export async function setPaymentStatus(orderId: string, status: PaymentStatus): Promise<Order> {
  const client = createServiceClient();
  const { data, error } = await client
    .from('orders')
    .update({ payment_status: status })
    .eq('id', orderId)
    .select()
    .single();

  if (error) throw error;
  return mapOrder(data);
}

/** Owner dashboard action (docs/11 §3.5) — the privileged `paid` transition. */
export async function markPaid(orderId: string, reference?: string | null): Promise<Order> {
  const client = createServiceClient();
  const { data, error } = await client
    .from('orders')
    .update({
      payment_status: 'paid',
      paid_at: new Date().toISOString(),
      ...(reference !== undefined ? { payment_reference: reference } : {}),
    })
    .eq('id', orderId)
    .select()
    .single();

  if (error) throw error;
  return mapOrder(data);
}

/** Owner dashboard action (docs/11 §3.5). */
export async function markRefunded(orderId: string): Promise<Order> {
  const client = createServiceClient();
  const { data, error } = await client
    .from('orders')
    .update({ payment_status: 'refunded' })
    .eq('id', orderId)
    .select()
    .single();

  if (error) throw error;
  return mapOrder(data);
}
