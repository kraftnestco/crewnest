import 'server-only';
import { z } from 'zod';
import * as sessions from '@/services/sessions';
import { notifyBoth } from '@/services/notifications';
import type { ToolContext, ToolExecutor } from './registry';

/**
 * flag_image_ambiguous — the model's escape hatch for a genuinely ambiguous
 * customer photo it can't confidently act on. Raises the same session-scoped
 * pending-clarification pointer used by the voice/video human-review paths and
 * the same hard-stop `is_human_handoff` a manual takeover would set (docs:
 * media-handoff plan) — resolved from the inbox's clarification panel.
 * Deliberately requires an image attachment THIS turn so it can't become a
 * generic substitute for `[HUMAN_HANDOFF]`.
 */

const argsSchema = z.object({
  question: z.string().min(1).max(500),
  options: z.array(z.string().max(120)).max(5).optional(),
});

export const flagImageAmbiguousTool: ToolExecutor = {
  def: {
    name: 'flag_image_ambiguous',
    description:
      "Flag a customer's photo as too ambiguous to confidently act on, and ask a human to " +
      "clarify. Only call this for a genuinely ambiguous image — not as a substitute for guessing " +
      "or for a general handoff. Ask one specific, closed question a human can answer quickly; " +
      "optionally supply a short list of likely answers as quick-pick options.",
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        options: { type: 'array', items: { type: 'string' } },
      },
      required: ['question'],
    },
  },

  argsSchema,

  async execute(rawArgs: unknown, ctx: ToolContext) {
    const args = rawArgs as z.infer<typeof argsSchema>;

    const image = ctx.attachments?.find((a) => a.kind === 'image');
    if (!image) {
      return { error: 'No image was sent this turn — use [HUMAN_HANDOFF] instead if you need a human for another reason.' };
    }

    await sessions.setPendingClarification(ctx.session.id, {
      kind: 'image_ambiguous',
      question: args.question,
      options: args.options,
      attachmentStoragePath: image.storagePath,
      raisedAt: new Date().toISOString(),
    });
    await sessions.setHandoff(ctx.session.id, true);

    await notifyBoth({
      tenantId: ctx.tenant.id,
      type: 'media_review',
      entityType: 'session',
      entityId: ctx.session.id,
      agency: {
        title: 'Photo needs review',
        body: `${ctx.tenant.businessName} — ${args.question}`,
        link: `/admin/chat?session=${ctx.session.id}`,
      },
      tenant: {
        title: 'A photo needs your input',
        body: args.question,
        link: `/dashboard/chat?session=${ctx.session.id}`,
      },
    });

    return { flagged: true };
  },
};
