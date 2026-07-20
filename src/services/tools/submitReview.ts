import 'server-only';
import { z } from 'zod';
import * as orders from '@/services/orders';
import * as sessions from '@/services/sessions';
import { notifyBoth } from '@/services/notifications';
import type { ToolContext, ToolExecutor } from './registry';

/**
 * submit_review — records a customer's post-fulfillment rating/feedback. Only
 * ever advertised to the model when `session.pendingReviewOrderId` is set
 * (registry.ts's session-aware gate), and re-validated here server-side since a
 * tool-call arg is still untrusted input, not a replacement for that check.
 */

const argsSchema = z.object({
  rating: z.number().int().min(1).max(5),
  feedback: z.string().optional(),
});

export const submitReviewTool: ToolExecutor = {
  def: {
    name: 'submit_review',
    description:
      "Record the customer's post-fulfillment rating (1-5) and a concise transcription of any " +
      'feedback they gave. Only call this once the customer has given an explicit 1-5 rating.',
    parameters: {
      type: 'object',
      properties: {
        rating: { type: 'integer', minimum: 1, maximum: 5 },
        feedback: { type: 'string' },
      },
      required: ['rating'],
    },
  },

  argsSchema,

  async execute(rawArgs: unknown, ctx: ToolContext) {
    const args = rawArgs as z.infer<typeof argsSchema>;

    const orderId = ctx.session.pendingReviewOrderId;
    if (!orderId) {
      return { error: 'No order is currently awaiting a review from this conversation.' };
    }

    const order = await orders.getById(orderId);
    if (!order || order.tenantId !== ctx.tenant.id) {
      await sessions.setPendingReview(ctx.session.id, null);
      return { error: 'That order could not be found.' };
    }
    if (order.reviewSubmittedAt) {
      await sessions.setPendingReview(ctx.session.id, null);
      return { error: 'A review has already been recorded for this order.' };
    }

    const updated = await orders.submitReview(orderId, args.rating, args.feedback?.trim() || null);
    await sessions.setPendingReview(ctx.session.id, null);

    // Confirmed product decision: only low ratings (1-3) page the business — 4-5
    // stars are stored and visible in order history without a notification.
    if (args.rating <= 3) {
      const itemsSummary = updated.items.map((i) => `${i.name} x${i.qty}`).join(', ') || 'order';
      const body = [itemsSummary, updated.reviewText].filter(Boolean).join(' — ');
      await notifyBoth({
        tenantId: ctx.tenant.id,
        type: 'review',
        entityType: 'order',
        entityId: order.id,
        agency: {
          title: `Low rating (${args.rating}/5) — ${ctx.tenant.businessName}`,
          body,
          link: '/admin/orders?status=fulfilled',
        },
        tenant: {
          title: `New rating: ${args.rating}/5`,
          body,
          link: '/dashboard/orders',
        },
      });
    }

    return { recorded: true, rating: args.rating };
  },
};
