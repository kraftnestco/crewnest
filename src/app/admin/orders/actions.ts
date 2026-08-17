'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import * as orderService from '@/services/orders';
import * as tenants from '@/services/tenants';
import * as sessions from '@/services/sessions';
import { sendTemplate, sendText } from '@/services/meta/send';
import * as media from '@/services/meta/media';
import { applyOrderStockEffects } from '@/services/inventoryStore';
import type { Database } from '@/types/database';
import type { OrderAttachment, OrderItem, Tenant } from '@/types/domain';
import { orderRef } from '@/lib/orderRef';
import { log } from '@/lib/log';

export type OrderRow = Database['public']['Tables']['orders']['Row'];
export type OrderStatus = Database['public']['Enums']['order_status'];
export type OrderSort = 'date_desc' | 'date_asc' | 'price_asc' | 'price_desc';

const PAGE_SIZE = 25;

/** Quote-request wording for service tenants (docs/10 §3.3) vs. "order" for product tenants. */
function orderNoun(tenant: Tenant | null): string {
  return tenant?.businessType === 'service' ? 'request' : 'order';
}

/**
 * "order KN-0803-5" / "request KN-0803-5" — the customer-facing reference from
 * lib/orderRef, never the raw uuid and no longer a bare "#5" (which read like a
 * test and advertised how few orders a business had taken).
 *
 * Composes the FULL noun phrase, not just the reference, so call sites never
 * have to reason about grammar around the null fallback: order_number is only
 * null in the narrow crash window create_order_atomic otherwise prevents, and
 * "your order" still reads correctly wherever the reference would have gone.
 */
function orderLabel(
  noun: string,
  order: Pick<OrderRow, 'order_number' | 'created_at'>,
  tenant: Tenant | null,
): string {
  const ref = orderRef({
    businessName: tenant?.businessName,
    number: order.order_number,
    createdAt: order.created_at,
    timezone: tenant?.timezone,
  });
  return ref ? `${noun} ${ref}` : `your ${noun}`;
}

/** Sentence-initial capitalisation for `orderLabel`'s output ("order KN-0803-5" → "Order KN-0803-5"). */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Shared customer-facing side effect for every order status/payment transition
 * (docs: order-event-messaging plan, Phase A) — generalises the insert+sendText
 * pattern `approveOrderAction` originated. The `chat_messages` insert throws (it's
 * the record of what we told the customer); `sendText` and the status-history
 * append are both best-effort so a delivery hiccup never masks the DB transition
 * that already succeeded.
 */
async function notifyCustomerOfOrderEvent(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  order: Pick<OrderRow, 'id' | 'tenant_id' | 'session_id' | 'platform' | 'external_user_id'>,
  tenant: Tenant | null,
  text: string,
  historyEvent: string,
): Promise<void> {
  let messageId: string | null = null;
  if (order.session_id) {
    const { data: inserted, error: insertError } = await supabase
      .from('chat_messages')
      .insert({
        session_id: order.session_id,
        tenant_id: order.tenant_id,
        role: 'assistant',
        content: text,
      })
      .select('id')
      .single();
    if (insertError) throw new Error(insertError.message);
    messageId = inserted?.id ?? null;
  }

  if (tenant && order.platform && order.platform !== 'web' && order.external_user_id) {
    try {
      await sendText({ tenant, platform: order.platform, to: order.external_user_id, text });
    } catch (err) {
      log.error('[orders] customer notify send failed', {
        orderId: order.id,
        event: historyEvent,
        error: err instanceof Error ? err.message : String(err),
      });
      if (messageId) {
        await supabase.from('chat_messages').update({ delivery_failed: true }).eq('id', messageId);
      }
    }
  }

  try {
    await orderService.appendStatusEvent(order.id, historyEvent);
  } catch (err) {
    log.error('[orders] status-history append failed', {
      orderId: order.id,
      event: historyEvent,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface GetOrdersPageInput {
  /** Zero-based page offset. Reset to zero whenever a filter or sort changes. */
  offset?: number;
  status?: OrderStatus | 'all';
  sort?: OrderSort;
  /**
   * Agency-only client filter (docs: admin orders client filter, mirrors the
   * notification bell's dropdown). Narrows an already-visible RLS result set —
   * never widens it, so passing a tenantId the caller can't actually see just
   * returns zero rows, not a leak. A tenant-scoped caller's own RLS policy
   * already restricts every query to their tenant, so this is a no-op for them.
   */
  tenantId?: string | null;
}

export interface GetOrdersPageResult {
  orders: OrderRow[];
  hasMore: boolean;
}

/**
 * Server-sorted pagination so date and price sorts apply to the entire order
 * history, not only the rows already loaded in the browser. This still goes
 * through the RLS-authenticated server client, never the browser client.
 */
export async function getOrdersPageAction(input: GetOrdersPageInput): Promise<GetOrdersPageResult> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from('orders').select('*');

  if (input.status && input.status !== 'all') {
    query = query.eq('status', input.status);
  }
  if (input.tenantId) {
    query = query.eq('tenant_id', input.tenantId);
  }

  switch (input.sort ?? 'date_desc') {
    case 'date_asc':
      query = query.order('created_at', { ascending: true });
      break;
    case 'price_asc':
      query = query
        .order('amount_total', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false });
      break;
    case 'price_desc':
      query = query
        .order('amount_total', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });
      break;
    default:
      query = query.order('created_at', { ascending: false });
  }

  const offset = Math.max(0, input.offset ?? 0);
  const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
  if (error) throw new Error(error.message);

  return { orders: data ?? [], hasMore: (data ?? []).length === PAGE_SIZE };
}

/**
 * Mint a short-TTL signed URL for an order attachment. Same ownership-verify
 * pattern as `getMessageMediaUrlAction` in admin/chat/actions.ts: the client
 * supplies the order id, not a bare storage path, and we confirm the path is
 * actually one of THIS order's own attachments before signing (docs/10 §7).
 */
export async function getOrderMediaUrlAction(orderId: string, storagePath: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data: order, error } = await supabase
    .from('orders')
    .select('id, attachments, payment_proof')
    .eq('id', orderId)
    .single();

  if (error || !order) return null;

  const attachments = (order.attachments as unknown as OrderAttachment[] | null) ?? [];
  const proof = order.payment_proof as unknown as OrderAttachment | null;
  const owned = attachments.some((a) => a.storagePath === storagePath) || proof?.storagePath === storagePath;
  if (!owned) return null;

  return media.getSignedUrl(storagePath);
}

/**
 * Approve/Reject: writes go through the service-role client (orders has no
 * authenticated UPDATE policy — migration 0009's own comment says so), but the
 * RLS-authenticated read below acts as the access check, mirroring
 * `manualSendAction`'s "read-as-access-check" pattern in admin/chat/actions.ts.
 * See docs/10 §3.4.
 */
export async function approveOrderAction(orderId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select(
      'id, tenant_id, session_id, platform, external_user_id, customer_name, customer_address, items, status, order_number, created_at',
    )
    .eq('id', orderId)
    .single();

  if (orderError || !order) {
    throw new Error(orderError?.message ?? 'Order not found.');
  }
  if (order.status !== 'pending') {
    throw new Error('Only pending orders can be approved.');
  }

  await orderService.approve(orderId);

  const tenant = await tenants.getById(order.tenant_id);

  // Inventory Lite (docs/19 I1) — a pending order only consumes stock now, at the
  // pending→confirmed transition, mirroring the confirmed path in createOrder.ts.
  // Best-effort: a stock write must never fail the approval.
  if (tenant) {
    try {
      const items = (order.items as unknown as OrderItem[]) ?? [];
      await applyOrderStockEffects(
        { id: tenant.id, businessName: tenant.businessName },
        items.map((i) => ({ name: i.name, qty: i.qty })),
      );
    } catch (err) {
      log.error('[orders] stock decrement failed (approve)', {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Best-effort owner push, same path as the bypass-mode confirm in createOrder.ts.
  if (tenant?.ownerNotifyWhatsapp && tenant.ownerNotifyTemplate) {
    try {
      const items = (order.items as unknown as OrderItem[]) ?? [];
      const itemsSummary = items.map((i) => `${i.name} x${i.qty}`).join(', ');
      await sendTemplate({
        tenant,
        to: tenant.ownerNotifyWhatsapp,
        templateName: tenant.ownerNotifyTemplate,
        bodyParams: [order.customer_name ?? '', itemsSummary, order.customer_address ?? ''],
      });
      await orderService.markOwnerNotified(orderId);
    } catch (err) {
      log.error('[orders] owner notify failed (approve)', {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const noun = orderNoun(tenant);
  await notifyCustomerOfOrderEvent(
    supabase,
    order,
    tenant,
    `${capitalize(orderLabel(noun, order, tenant))} is confirmed.`,
    'confirmed',
  );

  revalidatePath('/admin/orders');
}

/** Reject → `cancelled`; the customer is notified with the optional reason appended. */
export async function rejectOrderAction(orderId: string, reason?: string): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, tenant_id, session_id, platform, external_user_id, status, notes, order_number, created_at')
    .eq('id', orderId)
    .single();

  if (orderError || !order) {
    throw new Error(orderError?.message ?? 'Order not found.');
  }
  if (order.status !== 'pending') {
    throw new Error('Only pending orders can be rejected.');
  }

  const trimmedReason = reason?.trim();
  const notes = trimmedReason ? [order.notes, `Rejected: ${trimmedReason}`].filter(Boolean).join('\n') : order.notes;

  await orderService.reject(orderId, notes);

  const tenant = await tenants.getById(order.tenant_id);
  const noun = orderNoun(tenant);
  const suffix = trimmedReason ? ` — ${trimmedReason}` : '';
  await notifyCustomerOfOrderEvent(
    supabase,
    order,
    tenant,
    `We're sorry, but we can't accept this ${orderLabel(noun, order, tenant)}${suffix}. Feel free to reach out if you have questions.`,
    'cancelled',
  );

  revalidatePath('/admin/orders');
}

/**
 * Owner-initiated cancellation from either Orders dashboard. Unlike "Reject"
 * (pending review only), this also covers confirmed orders. Fulfilled and
 * already-cancelled orders are terminal. The authenticated read is the access
 * check before the service-role write, matching approve/reject above.
 */
export async function cancelOrderAction(orderId: string, reason: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new Error('Please provide a cancellation reason.');

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, tenant_id, session_id, platform, external_user_id, status, notes, order_number, created_at')
    .eq('id', orderId)
    .single();

  if (orderError || !order) {
    throw new Error(orderError?.message ?? 'Order not found.');
  }
  if (order.status === 'fulfilled') {
    throw new Error('A fulfilled order can no longer be cancelled.');
  }
  if (order.status === 'cancelled') {
    throw new Error('This order is already cancelled.');
  }

  const notes = [order.notes, `Cancelled by business: ${trimmedReason}`].filter(Boolean).join('\n');
  await orderService.reject(orderId, notes);

  const tenant = await tenants.getById(order.tenant_id);
  const noun = orderNoun(tenant);
  await notifyCustomerOfOrderEvent(
    supabase,
    order,
    tenant,
    `${capitalize(orderLabel(noun, order, tenant))} has been cancelled — ${trimmedReason}.`,
    'cancelled',
  );

  revalidatePath('/admin/orders');
  revalidatePath('/dashboard/orders');
}

/**
 * Mark fulfilled: owner-only manual close-out for a confirmed order/service. Same
 * access-check pattern as approve/reject. Also seeds the session's pending-review
 * pointer (docs: order-event-messaging plan, Phase B) so the AI's next reply from
 * this customer asks for a rating.
 */
export async function fulfillOrderAction(orderId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, tenant_id, session_id, platform, external_user_id, status, order_number, created_at')
    .eq('id', orderId)
    .single();

  if (orderError || !order) {
    throw new Error(orderError?.message ?? 'Order not found.');
  }
  if (order.status !== 'confirmed') {
    throw new Error('Only confirmed orders can be marked fulfilled.');
  }

  await orderService.fulfill(orderId);

  if (order.session_id) {
    try {
      await sessions.setPendingReview(order.session_id, order.id);
    } catch (err) {
      log.error('[orders] pending-review pointer set failed', {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const tenant = await tenants.getById(order.tenant_id);
  const noun = orderNoun(tenant);
  await notifyCustomerOfOrderEvent(
    supabase,
    order,
    tenant,
    `${capitalize(orderLabel(noun, order, tenant))} is complete — thank you! We'd love your feedback: reply with a rating from 1 to 5 (and any comments) whenever you get a chance.`,
    'fulfilled',
  );

  revalidatePath('/admin/orders');
}

/**
 * Mark paid/refunded (docs/11 §3.5) — the privileged human `payment_status` transition
 * (§1.3). Same read-as-access-check → service-role write pattern as approve/reject;
 * payment_status is deliberately NOT gated on order `status` (the two axes stay
 * decoupled, §3.4) so any non-terminal payment_status is eligible.
 */
export async function markPaidAction(orderId: string, reference?: string): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, tenant_id, session_id, platform, external_user_id, payment_status, order_number, created_at')
    .eq('id', orderId)
    .single();

  if (orderError || !order) {
    throw new Error(orderError?.message ?? 'Order not found.');
  }
  if (order.payment_status === 'paid' || order.payment_status === 'refunded') {
    throw new Error('This order is already paid or refunded.');
  }

  await orderService.markPaid(orderId, reference?.trim() || null);

  const tenant = await tenants.getById(order.tenant_id);
  const noun = orderNoun(tenant);
  await notifyCustomerOfOrderEvent(
    supabase,
    order,
    tenant,
    `We've received your payment for ${orderLabel(noun, order, tenant)} — thank you!`,
    'payment:paid',
  );

  revalidatePath('/admin/orders');
}

export async function markRefundedAction(orderId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, tenant_id, session_id, platform, external_user_id, payment_status, order_number, created_at')
    .eq('id', orderId)
    .single();

  if (orderError || !order) {
    throw new Error(orderError?.message ?? 'Order not found.');
  }
  if (order.payment_status !== 'paid') {
    throw new Error('Only a paid order can be refunded.');
  }

  await orderService.markRefunded(orderId);

  const tenant = await tenants.getById(order.tenant_id);
  const noun = orderNoun(tenant);
  await notifyCustomerOfOrderEvent(
    supabase,
    order,
    tenant,
    `Your payment for ${orderLabel(noun, order, tenant)} has been refunded.`,
    'payment:refunded',
  );

  revalidatePath('/admin/orders');
}

/**
 * Stage K "Reject" (docs/11 §5, acceptance criteria): a mis-attached or unconvincing
 * proof drops back to `unpaid` — the order itself is untouched, so the customer can
 * simply send a better receipt. Same access-check pattern as the actions above. This
 * previously left the customer with no signal at all that their proof was rejected
 * (a real bug — they'd just wait forever); now notified like every other transition.
 */
export async function rejectPaymentProofAction(orderId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, tenant_id, session_id, platform, external_user_id, payment_status, order_number, created_at')
    .eq('id', orderId)
    .single();

  if (orderError || !order) {
    throw new Error(orderError?.message ?? 'Order not found.');
  }
  if (order.payment_status !== 'awaiting_verification') {
    throw new Error('Only a payment awaiting verification can be rejected.');
  }

  await orderService.setPaymentStatus(orderId, 'unpaid');

  const tenant = await tenants.getById(order.tenant_id);
  const noun = orderNoun(tenant);
  await notifyCustomerOfOrderEvent(
    supabase,
    order,
    tenant,
    `We couldn't verify the payment proof you sent for ${orderLabel(noun, order, tenant)} — could you send a clearer screenshot or receipt of the completed payment?`,
    'payment:proof_rejected',
  );

  revalidatePath('/admin/orders');
}
