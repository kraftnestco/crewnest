'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import * as orderService from '@/services/orders';
import * as tenants from '@/services/tenants';
import { sendTemplate, sendText } from '@/services/meta/send';
import * as media from '@/services/meta/media';
import type { Database } from '@/types/database';
import type { OrderAttachment, OrderItem } from '@/types/domain';

export type OrderRow = Database['public']['Tables']['orders']['Row'];
export type OrderStatus = Database['public']['Enums']['order_status'];

const PAGE_SIZE = 25;

export interface GetOrdersPageInput {
  /** created_at cursor — fetch orders strictly older than this. Omit for the newest page. */
  before?: string | null;
  status?: OrderStatus | 'all';
}

export interface GetOrdersPageResult {
  orders: OrderRow[];
  hasMore: boolean;
}

/**
 * Cursor-paginated (not offset) so realtime inserts prepending to an already-loaded
 * list never shift page boundaries — see the anon-role fix in admin/chat/actions.ts
 * for why this goes through the RLS-authenticated server client, not the browser client.
 */
export async function getOrdersPageAction(input: GetOrdersPageInput): Promise<GetOrdersPageResult> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  if (input.status && input.status !== 'all') {
    query = query.eq('status', input.status);
  }
  if (input.before) {
    query = query.lt('created_at', input.before);
  }

  const { data, error } = await query;
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
    .select('id, tenant_id, session_id, platform, external_user_id, customer_name, customer_address, items, status')
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
      console.error('[orders] owner notify failed (approve)', {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Customer confirmation — mirrors manualSendAction's chat_messages insert + sendText pattern.
  const confirmText = `Your order is confirmed — order #${order.id}.`;
  let confirmMessageId: string | null = null;
  if (order.session_id) {
    const { data: inserted, error: insertError } = await supabase
      .from('chat_messages')
      .insert({
        session_id: order.session_id,
        tenant_id: order.tenant_id,
        role: 'assistant',
        content: confirmText,
      })
      .select('id')
      .single();
    if (insertError) throw new Error(insertError.message);
    confirmMessageId = inserted?.id ?? null;
  }
  if (tenant && order.platform && order.platform !== 'web' && order.external_user_id) {
    try {
      await sendText({ tenant, platform: order.platform, to: order.external_user_id, text: confirmText });
    } catch (err) {
      console.error('[orders] customer confirm send failed (approve)', {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
      if (confirmMessageId) {
        await supabase.from('chat_messages').update({ delivery_failed: true }).eq('id', confirmMessageId);
      }
    }
  }

  revalidatePath('/admin/orders');
}

/** Reject → `cancelled`; the customer is not auto-messaged (docs/10 §3.3 — owner handles it via manual send). */
export async function rejectOrderAction(orderId: string, reason?: string): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, status, notes')
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
    .select('id, payment_status')
    .eq('id', orderId)
    .single();

  if (orderError || !order) {
    throw new Error(orderError?.message ?? 'Order not found.');
  }
  if (order.payment_status === 'paid' || order.payment_status === 'refunded') {
    throw new Error('This order is already paid or refunded.');
  }

  await orderService.markPaid(orderId, reference?.trim() || null);
  revalidatePath('/admin/orders');
}

export async function markRefundedAction(orderId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, payment_status')
    .eq('id', orderId)
    .single();

  if (orderError || !order) {
    throw new Error(orderError?.message ?? 'Order not found.');
  }
  if (order.payment_status !== 'paid') {
    throw new Error('Only a paid order can be refunded.');
  }

  await orderService.markRefunded(orderId);
  revalidatePath('/admin/orders');
}

/**
 * Stage K "Reject" (docs/11 §5, acceptance criteria): a mis-attached or unconvincing
 * proof drops back to `unpaid` — the order itself is untouched, so the customer can
 * simply send a better receipt. Same access-check pattern as the actions above.
 */
export async function rejectPaymentProofAction(orderId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, payment_status')
    .eq('id', orderId)
    .single();

  if (orderError || !order) {
    throw new Error(orderError?.message ?? 'Order not found.');
  }
  if (order.payment_status !== 'awaiting_verification') {
    throw new Error('Only a payment awaiting verification can be rejected.');
  }

  await orderService.setPaymentStatus(orderId, 'unpaid');
  revalidatePath('/admin/orders');
}
