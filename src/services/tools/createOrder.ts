import 'server-only';
import { z } from 'zod';
import * as orders from '@/services/orders';
import * as sessions from '@/services/sessions';
import { sendTemplate } from '@/services/meta/send';
import { notifyBoth } from '@/services/notifications';
import { applyOrderStockEffects } from '@/services/inventoryStore';
import { MAX_ORDERS_PER_SESSION_WINDOW, PAYMENT_METHOD_PRIORITY } from '@/lib/constants';
import type { PaymentMethod, Tenant } from '@/types/domain';
import { orderRef } from '@/lib/orderRef';
import type { ToolContext, ToolExecutor } from './registry';
import { log } from '@/lib/log';

/**
 * create_order — captures a confirmed customer order. The model must only call
 * this after the customer has explicitly confirmed the full order (enforced by
 * the order-flow system-prompt block, docs/09-ORDERS-AND-TOOLS.md §5).
 */

const argsSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().min(1),
        qty: z.number().int().positive(),
        customization: z.string().optional(),
        price: z.number().optional(),
      }),
    )
    .min(1),
  customer_name: z.string().min(1),
  customer_phone: z.string().min(1),
  customer_address: z.string().min(1),
  notes: z.string().optional(),
  /** Untrusted hint only — never the source of truth. Normalised/resolved server-side (docs/11 §3.3.1 A). */
  payment_preference: z.string().optional(),
});

/** Normalises a free-text customer payment hint into a method — unresolved input yields null. */
function normalizePaymentPreference(hint: string | undefined): PaymentMethod | null {
  if (!hint) return null;
  const s = hint.toLowerCase();
  if (/jazzcash|easypaisa|bank|transfer/.test(s)) return 'manual_transfer';
  if (/cash|cod/.test(s)) return 'cod';
  if (/card|online|link/.test(s)) return 'gateway';
  return null;
}

/**
 * Resolves the order's payment method entirely server-side (docs/11 §3.3.1 A) —
 * the model's `payment_preference` is only ever a hint, never binding.
 */
function resolvePaymentMethod(tenant: Tenant, preference: PaymentMethod | null): PaymentMethod | null {
  const enabled = tenant.paymentMethods.filter((m): m is PaymentMethod =>
    (['cod', 'manual_transfer', 'gateway'] as const).includes(m),
  );
  if (!tenant.paymentsEnabled || enabled.length === 0) return null;
  if (preference && enabled.includes(preference)) return preference;
  if (enabled.length === 1) return enabled[0];
  return PAYMENT_METHOD_PRIORITY.find((m) => enabled.includes(m)) ?? enabled[0];
}

/** Advisory total only (docs/11 §3.3.1 A) — null unless every item carries a positive numeric price. */
function computeAmountTotal(items: z.infer<typeof argsSchema>['items']): number | null {
  if (!items.every((i) => typeof i.price === 'number' && i.price > 0)) return null;
  return items.reduce((sum, i) => sum + i.price! * i.qty, 0);
}

export const createOrderTool: ToolExecutor = {
  def: {
    name: 'create_order',
    description:
      'Create a confirmed customer order. Only call this after the customer has explicitly ' +
      'confirmed the complete order (items, name, address, phone) read back to them.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              qty: { type: 'integer', minimum: 1 },
              customization: { type: 'string' },
              price: { type: 'number' },
            },
            required: ['name', 'qty'],
          },
        },
        customer_name: { type: 'string' },
        customer_phone: { type: 'string' },
        customer_address: { type: 'string' },
        notes: { type: 'string' },
        payment_preference: { type: 'string' },
      },
      required: ['items', 'customer_name', 'customer_phone', 'customer_address'],
    },
  },

  argsSchema,

  async execute(rawArgs: unknown, ctx: ToolContext) {
    const args = rawArgs as z.infer<typeof argsSchema>;

    // Server-decided, never model-supplied (docs/10 §3.3): approval-required tenants
    // gate every create_order call, custom or catalogue, since the tool has no
    // reliable "this is a custom order" signal of its own.
    const status = ctx.tenant.customOrdersEnabled && ctx.tenant.customOrdersRequireApproval ? 'pending' : 'confirmed';

    const recentCount = await orders.countRecentForSession(ctx.session.id);
    if (recentCount >= MAX_ORDERS_PER_SESSION_WINDOW) {
      return { error: 'Too many orders from this conversation recently. Please ask them to contact the business directly.' };
    }

    const fingerprint = orders.computeFingerprint(
      args.items,
      { name: args.customer_name, phone: args.customer_phone, address: args.customer_address },
      ctx.attachments,
    );

    // Money is server-resolved end to end (docs/11 §3.3.1 A) — the model's
    // payment_preference is only ever an untrusted hint into this resolution.
    const preference = normalizePaymentPreference(args.payment_preference);
    const paymentMethod = resolvePaymentMethod(ctx.tenant, preference);
    const amountTotal = paymentMethod ? computeAmountTotal(args.items) : null;
    const currency = paymentMethod ? ctx.tenant.defaultCurrency : null;

    // Identity is server-bound: tenant/session/platform/media come from ctx, never from args.
    // The duplicate check and insert happen atomically in one RPC (migration
    // 0021) to close a TOCTOU race between two near-simultaneous tool calls.
    const { order, duplicate } = await orders.createDeduped(
      {
        tenantId: ctx.tenant.id,
        sessionId: ctx.session.id,
        platform: ctx.session.platform,
        externalUserId: ctx.session.externalUserId,
        items: args.items,
        customerName: args.customer_name,
        customerPhone: args.customer_phone,
        customerAddress: args.customer_address,
        notes: args.notes ?? null,
        status,
        attachments: ctx.attachments?.length ? ctx.attachments : null,
        paymentMethod,
        amountTotal,
        currency,
      },
      fingerprint,
    );

    if (duplicate || !order) {
      return { orderNumber: null, status, duplicate: true };
    }

    // A new order in this session makes any earlier pending review pointer stale —
    // it would otherwise keep nudging the customer to rate a DIFFERENT, older order.
    if (ctx.session.pendingReviewOrderId) {
      try {
        await sessions.setPendingReview(ctx.session.id, null);
      } catch (err) {
        log.error('[orders] failed to clear stale review pointer', {
          sessionId: ctx.session.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await notifyBoth({
      tenantId: ctx.tenant.id,
      type: 'new_order',
      entityType: 'order',
      entityId: order.id,
      agency: {
        title: status === 'pending' ? 'Order awaiting approval' : 'New order',
        body: `${ctx.tenant.businessName} — ${args.customer_name}`,
        link: status === 'pending' ? '/admin/orders?status=pending' : '/admin/orders',
      },
      tenant: {
        title: status === 'pending' ? 'New order — awaiting your approval' : 'New order received',
        body: args.customer_name,
        link: '/dashboard/orders',
      },
    });

    // Best-effort owner push: awaited (survives serverless teardown after execute()
    // returns) but never lets a delivery failure block the customer's confirmation.
    // Pending orders skip this and surface via the admin approval queue instead
    // (docs/10 §3.4) — the owner push fires at Approve time, once truly confirmed.
    if (order.status === 'confirmed' && ctx.tenant.ownerNotifyWhatsapp && ctx.tenant.ownerNotifyTemplate) {
      try {
        const itemsSummary = args.items.map((i) => `${i.name} x${i.qty}`).join(', ');
        await sendTemplate({
          tenant: ctx.tenant,
          to: ctx.tenant.ownerNotifyWhatsapp,
          templateName: ctx.tenant.ownerNotifyTemplate,
          bodyParams: [args.customer_name, itemsSummary, args.customer_address],
        });
        await orders.markOwnerNotified(order.id);
      } catch (err) {
        log.error('[orders] owner notify failed', {
          tenantId: ctx.tenant.id,
          orderId: order.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Inventory Lite (docs/19 I1) — decrement tracked stock the moment an order is
    // truly confirmed. Pending orders decrement at approval time instead (admin
    // orders action), so a rejected order never wrongly consumes stock. Fully
    // best-effort: a stock write must never fail the customer's confirmation.
    if (order.status === 'confirmed') {
      try {
        await applyOrderStockEffects(
          { id: ctx.tenant.id, businessName: ctx.tenant.businessName },
          args.items.map((i) => ({ name: i.name, qty: i.qty })),
        );
      } catch (err) {
        log.error('[orders] stock decrement failed', {
          tenantId: ctx.tenant.id,
          orderId: order.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Widened result (docs/11 §2.2) — the model reads the payment total back from
    // here; it must never invent or restate an amount on its own.
    const payment = order.paymentMethod
      ? {
          method: order.paymentMethod,
          ...(order.paymentMethod === 'manual_transfer' && ctx.tenant.paymentInstructions
            ? { instructions: ctx.tenant.paymentInstructions }
            : {}),
          ...(order.amountTotal !== null ? { amountTotal: order.amountTotal, currency: order.currency } : {}),
        }
      : undefined;

    return {
      // The per-tenant sequential number (#7), NEVER order.id. Anything returned
      // here can be read aloud to the customer, and the model did exactly that
      // with the raw uuid — "Order ID: 4f5e0565-0fb5-..." (2026-08-03). The
      // uuid stays internal; migration 0040 exists precisely for this.
      // The customer-facing reference (KN-0803-5), not a bare number and never
      // the uuid. Anything returned here can be read aloud verbatim.
      orderRef: orderRef({
        businessName: ctx.tenant.businessName,
        number: order.orderNumber,
        createdAt: order.createdAt,
        timezone: ctx.tenant.timezone,
      }),
      status: order.status,
      paymentStatus: order.paymentStatus,
      ...(payment ? { payment } : {}),
    };
  },
};
