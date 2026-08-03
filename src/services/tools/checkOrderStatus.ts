import 'server-only';
import { z } from 'zod';
import * as orders from '@/services/orders';
import { orderRef } from '@/lib/orderRef';
import type { ToolContext, ToolExecutor } from './registry';

/**
 * check_order_status — lets a returning customer ask about an order they already
 * placed (or a quote request, for service tenants). Scoped entirely by
 * ctx.session.id (server-bound identity, docs/09 §2.4) — sessions persist per
 * (tenant, platform, external_user_id), so this also covers a customer asking
 * again days later on the same WhatsApp/DM thread.
 */

const argsSchema = z.object({
  order_id: z.string().optional(),
});

export const checkOrderStatusTool: ToolExecutor = {
  def: {
    name: 'check_order_status',
    description:
      "Look up the status of the customer's own past order(s) in this conversation. " +
      'Call this when a customer asks about an order/quote they already placed. If they gave an ' +
      'order id, pass it; otherwise omit it to see their most recent orders.',
    parameters: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'The order id, if the customer gave one.' },
      },
    },
  },

  argsSchema,

  async execute(rawArgs: unknown, ctx: ToolContext) {
    const args = rawArgs as z.infer<typeof argsSchema>;

    const recent = await orders.listForSession(ctx.session.id);
    const matches = args.order_id ? recent.filter((o) => o.id === args.order_id) : recent;

    if (matches.length === 0) {
      return { found: false, message: 'No matching order found in this conversation.' };
    }

    return {
      found: true,
      orders: matches.map((o) => ({
        orderRef: orderRef({
          businessName: ctx.tenant.businessName,
          number: o.orderNumber,
          createdAt: o.createdAt,
          timezone: ctx.tenant.timezone,
        }),
        status: o.status,
        items: o.items.map((i) => ({ name: i.name, qty: i.qty })),
        placedAt: o.createdAt,
      })),
    };
  },
};
