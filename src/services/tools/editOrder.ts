import 'server-only';
import { z } from 'zod';
import * as orders from '@/services/orders';
import { notifyBoth } from '@/services/notifications';
import { orderRef } from '@/lib/orderRef';
import type { ToolContext, ToolExecutor } from './registry';

/**
 * edit_order — lets a customer change an order they already placed. Scoped
 * entirely by ctx.session.id (server-bound identity, docs/09 §2.5); the model
 * can only touch that session's own orders. Guarded by docs/11 §4.2: only
 * pending/confirmed orders are editable — a paid/fulfilled order is beyond the
 * AI's authority and hands off instead.
 */

const argsSchema = z.object({
  order_id: z.string().optional(),
  items: z
    .array(
      z.object({
        name: z.string().min(1),
        qty: z.number().int().positive(),
        customization: z.string().optional(),
        price: z.number().optional(),
      }),
    )
    .min(1)
    .optional(),
  customer_name: z.string().min(1).optional(),
  customer_phone: z.string().min(1).optional(),
  customer_address: z.string().min(1).optional(),
  notes: z.string().optional(),
});

export const editOrderTool: ToolExecutor = {
  def: {
    name: 'edit_order',
    description:
      "Change the details of a customer's own order they already placed (items, quantities, " +
      'delivery name/address/phone). Only works on an order that is not yet paid or fulfilled — if it ' +
      'fails, tell the customer a person needs to help with the change.',
    parameters: {
      type: 'object',
      properties: {
        order_id: {
          type: 'string',
          description: 'The order id, if the customer gave one; otherwise their most recent editable order is used.',
        },
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
      },
    },
  },

  argsSchema,

  async execute(rawArgs: unknown, ctx: ToolContext) {
    const args = rawArgs as z.infer<typeof argsSchema>;

    const target = await orders.findEditableForSession(ctx.session.id, args.order_id);
    if (!target) {
      return { error: 'No editable order found in this conversation.' };
    }
    if (!orders.isEditable(target)) {
      return { error: 'This order can no longer be edited.', needsHuman: true };
    }

    // Server-decided re-approval (docs/11 §4.3): mirrors create_order's own
    // tenant-level gate exactly — there's no reliable per-order "is this custom"
    // signal, so the same tenant flags that decide a new order's status also
    // decide whether an edit re-opens approval.
    const reapprove =
      target.status === 'confirmed' && ctx.tenant.customOrdersEnabled && ctx.tenant.customOrdersRequireApproval;

    const updated = await orders.edit(target.id, {
      items: args.items,
      customerName: args.customer_name,
      customerPhone: args.customer_phone,
      customerAddress: args.customer_address,
      notes: args.notes,
      status: reapprove ? 'pending' : undefined,
    });

    await notifyBoth({
      tenantId: ctx.tenant.id,
      type: 'order_updated',
      entityType: 'order',
      entityId: updated.id,
      agency: {
        title: reapprove ? 'Order edited — awaiting your approval' : 'Order edited by AI',
        body: `${ctx.tenant.businessName} — ${updated.customerName ?? 'Customer'}`,
        link: reapprove ? '/admin/orders?status=pending' : '/admin/orders',
      },
      tenant: {
        title: reapprove ? 'Order edited — awaiting your approval' : 'An order was edited',
        body: updated.customerName ?? 'Customer',
        link: '/dashboard/orders',
      },
    });

    return {
      orderRef: orderRef({
        businessName: ctx.tenant.businessName,
        number: updated.orderNumber,
        createdAt: updated.createdAt,
        timezone: ctx.tenant.timezone,
      }),
      status: updated.status,
    };
  },
};
