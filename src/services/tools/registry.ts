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
const ALL_TOOLS: ToolExecutor[] = [createOrderTool, checkOrderStatusTool, editOrderTool, cancelOrderTool];

/** Tenant-scoped: which tools this tenant may use, gated by tenant flags. */
export function getEnabledTools(tenant: Tenant): ToolExecutor[] {
  return ALL_TOOLS.filter((tool) => isToolEnabledForTenant(tool.def.name, tenant));
}

function isToolEnabledForTenant(toolName: string, tenant: Tenant): boolean {
  if (toolName === 'create_order') return tenant.ordersEnabled;
  if (toolName === 'check_order_status') return tenant.ordersEnabled;
  if (toolName === 'edit_order') return tenant.ordersEnabled;
  if (toolName === 'cancel_order') return tenant.ordersEnabled;
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
    console.error('[tools] executor failed', {
      tool: call.name,
      tenantId: ctx.tenant.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: 'Tool execution failed.' };
  }
}
