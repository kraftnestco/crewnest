/**
 * Server-only tool registry. Tools are defined ONLY here — the customer's message
 * can never introduce a tool; the model can only call tools we advertised in
 * `req.tools`. See docs/09-ORDERS-AND-TOOLS.md §2.4-2.5.
 *
 * Security invariant: the model supplies tool ARGUMENTS; the server supplies
 * tenant/session IDENTITY via `ToolContext`, which every executor must read
 * instead of trusting any id the model might emit in its args.
 */
import type { z } from 'zod';
import type { LlmToolCall, LlmToolDef } from '@/services/ai/provider';
import type { ChatSession, OrderAttachment, Tenant } from '@/types/domain';
import { createOrderTool } from './createOrder';
import { checkOrderStatusTool } from './checkOrderStatus';
import { editOrderTool } from './editOrder';
import { cancelOrderTool } from './cancelOrder';
import { submitReviewTool } from './submitReview';
import { flagImageAmbiguousTool } from './flagImageAmbiguous';
import { log } from '@/lib/log';

export interface ToolContext {
  tenant: Tenant;
  session: ChatSession;
  /** Media downloaded THIS turn (docs/10 §4.3) — server-bound, never from model args. */
  attachments?: OrderAttachment[];
}

export interface ToolExecutor {
  def: LlmToolDef;
  argsSchema: z.ZodTypeAny;
  execute(args: unknown, ctx: ToolContext): Promise<unknown>;
}

/** Registered here as each tool ships (empty ⇒ identical to the pre-tool-calling path). */
const ALL_TOOLS: ToolExecutor[] = [
  createOrderTool,
  checkOrderStatusTool,
  editOrderTool,
  cancelOrderTool,
  submitReviewTool,
  flagImageAmbiguousTool,
];

/**
 * Tenant-scoped (and, for the review flow, session-scoped): which tools this
 * tenant/session may use right now. `session` is optional so every other call
 * site (e.g. tenant-level checks with no session in hand) keeps working — it's
 * only required to ever see `submit_review` advertised.
 */
export function getEnabledTools(tenant: Tenant, session?: ChatSession): ToolExecutor[] {
  return ALL_TOOLS.filter((tool) => isToolEnabledForTenant(tool.def.name, tenant, session));
}

function isToolEnabledForTenant(toolName: string, tenant: Tenant, session?: ChatSession): boolean {
  // customOrdersEnabled implies order-taking too (docs/10 rides on the doc-09 order-taker,
  // but the intake wizard never exposes a separate ordersEnabled toggle — fixed 2026-07-20;
  // a custom-orders/payments tenant with ordersEnabled still false could never actually get
  // create_order/etc. advertised, so the model was told to call a tool it never had).
  const ordersOn = tenant.ordersEnabled || tenant.customOrdersEnabled;
  if (toolName === 'create_order') return ordersOn;
  if (toolName === 'check_order_status') return ordersOn;
  if (toolName === 'edit_order') return ordersOn;
  if (toolName === 'cancel_order') return ordersOn;
  // Only advertised the one turn it's legitimately usable — defense in depth on
  // top of submitReview.ts's own server-side re-check, not a replacement for it.
  if (toolName === 'submit_review') return ordersOn && Boolean(session?.pendingReviewOrderId);
  // Images are only ever shown to the model for custom-orders tenants (docs/10 §4) —
  // this tool would be unreachable for anyone else regardless, but gate explicitly.
  if (toolName === 'flag_image_ambiguous') return tenant.customOrdersEnabled;
  return false;
}

/** Parse+validate the model's args, run the executor, and return a result the model can see. */
export async function executeTool(call: LlmToolCall, ctx: ToolContext): Promise<unknown> {
  const tool = ALL_TOOLS.find((t) => t.def.name === call.name);
  if (!tool) return { error: `Unknown tool: ${call.name}` };

  let rawArgs: unknown;
  try {
    rawArgs = JSON.parse(call.arguments);
  } catch {
    return { error: 'Invalid arguments: not valid JSON.' };
  }

  const parsed = tool.argsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return { error: `Invalid arguments: ${parsed.error.message}` };
  }

  try {
    return await tool.execute(parsed.data, ctx);
  } catch (err) {
    log.error('[tools] executor failed', {
      tool: call.name,
      tenantId: ctx.tenant.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: 'Tool execution failed.' };
  }
}
