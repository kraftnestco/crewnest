import 'server-only';
import { z } from 'zod';
import * as orders from '@/services/orders';
import { revertOrderStockEffects } from '@/services/inventoryStore';
import { notifyBoth } from '@/services/notifications';
import { orderRef } from '@/lib/orderRef';
import type { ToolContext, ToolExecutor } from './registry';

/**
 * cancel_order — lets a customer cancel an order they already placed. Scoped
 * entirely by ctx.session.id (server-bound identity, docs/09 §2.5). Same
 * eligibility guard as edit_order (docs/11 §4.2): only pending/confirmed
 * orders can be cancelled — a paid/fulfilled order hands off instead.
 */

const argsSchema = z.object({
  order_id: z.string().optional(),
  reason: z.string().optional(),
});

export const cancelOrderTool: ToolExecutor = {
  def: {
    name: 'cancel_order',
    description:
      "Cancel a customer's own order they already placed. Only works on an order that is not yet paid " +
      'or fulfilled — if it fails, tell the customer a person needs to help with the cancellation.',
    parameters: {
      type: 'object',
      properties: {
        order_id: {
          type: 'string',
          description: 'The order id, if the customer gave one; otherwise their most recent cancellable order is used.',
        },
        reason: { type: 'string', description: 'Why the customer wants to cancel, if they said.' },
      },
    },
  },

  argsSchema,

  async execute(rawArgs: unknown, ctx: ToolContext) {
    const args = rawArgs as z.infer<typeof argsSchema>;

    const target = await orders.findEditableForSession(ctx.session.id, args.order_id);
    if (!target) {
      return { error: 'No cancellable order found in this conversation.' };
    }
    if (!orders.isEditable(target)) {
      return { error: 'This order can no longer be cancelled.', needsHuman: true };
    }

    const updated = await orders.cancel(target.id, args.reason ?? null);

    // Customer cancellation: if this was a confirmed order, its stock was
    // already consumed at confirmation time, so return those units.
    if (target.status === 'confirmed') {
      try {
        await revertOrderStockEffects(
          ctx.tenant.id,
          target.items.map((i) => ({ name: i.name, qty: i.qty })),
        );
      } catch {
        // Best-effort parity with order confirmation decrement: don't block the
        // customer cancellation if stock rollback fails.
      }
    }

    await notifyBoth({
      tenantId: ctx.tenant.id,
      type: 'order_updated',
      entityType: 'order',
      entityId: updated.id,
      agency: {
        title: 'Order cancelled by AI',
        body: `${ctx.tenant.businessName} — ${updated.customerName ?? 'Customer'}${args.reason ? `: ${args.reason}` : ''}`,
        link: '/admin/orders',
      },
      tenant: {
        title: 'An order was cancelled',
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
