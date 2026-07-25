import 'server-only';
import { z } from 'zod';
import type { LlmToolCall, LlmToolDef } from '@/services/ai/provider';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { MEMBER_ROLE_VALUES } from '@/lib/constants';
import { type CopilotAction } from '@/services/ai/copilot/actions';
import { log } from '@/lib/log';

/**
 * Admin Copilot tools (docs/20 Part 2, extended per HANDOFF-followups-admin.md
 * item 2). Mirrors `copilot/copilotTools.ts` in shape (`{ def, argsSchema,
 * execute }`). Two tools remain READ-ONLY and platform-wide (`lookup_tenant`,
 * `lookup_customer`) — this is the on-demand half of the admin copilot:
 * `buildAdminSnapshot.ts` still supplies the always-loaded agency-wide overview;
 * these tools let the operator drill into ONE named client or customer without
 * that detail sitting in every turn's prompt.
 *
 * Three more tools (`invite_team_member`, `set_stock`, `restock`) mirror the
 * Business Copilot's three actions (`copilot/copilotTools.ts`), but target a
 * NAMED client rather than the caller's own tenant. Like every copilot tool in
 * this codebase, they are side-effect-free at model time: they only resolve the
 * business name to a tenant id and STAGE a `CopilotAction` (via `AdminToolResult`
 * below) for the operator to review as a card — nothing writes here.
 * `applyAdminCopilotActionAction` (admin/copilot-actions.ts) is the only writer,
 * dispatching to the SAME already-auth-checked functions the owner-side apply
 * action uses (`inviteMember`, `setItemStockAction`, `restockItemAction`).
 *
 * Uses `createSupabaseServerClient()` (RLS), never the service client — per
 * docs/20 §2.2's standing rule, a platform admin already sees every tenant's rows
 * through RLS, so there is no reason for this path to hold a higher-privileged
 * client than the caller's own session grants.
 *
 * `lookup_customer` here intentionally surfaces customer name/phone and a message
 * preview across ANY tenant — wider than docs/20 §2.1.4's original "no PII, no
 * message content" v1 exclusion. That widening was an explicit, confirmed user
 * decision (2026-07-24): platform admins already have this data through
 * `/admin/clients/<id>` and `/admin/chat`, so a lookup tool is a new interface to
 * existing access, not a new privilege.
 */

/** A tool's plain-text result for the model, plus an optional staged action + its resolved target (admin tools only — read-only tools never set this). */
export interface AdminToolResult {
  text: string;
  staged?: { action: CopilotAction; tenantId: string; businessName: string };
}

export interface AdminCopilotTool {
  def: LlmToolDef;
  argsSchema: z.ZodTypeAny;
  execute(args: unknown): Promise<AdminToolResult>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

const TENANT_LIMIT = 5;
const LOOKUP_LIMIT = 5;
const MESSAGE_PREVIEW_LIMIT = 8;
const MESSAGE_CONTENT_CHARS = 240;

/** Escape ilike wildcards in user-provided search text before building a LIKE pattern. */
function ilikePattern(q: string): string {
  return `%${q.replace(/[%_]/g, '\\$&')}%`;
}

function formatOrderLine(o: {
  status: string;
  payment_status: string;
  items: unknown;
  amount_total: number | null;
  currency: string | null;
  created_at: string;
}): string {
  const items = Array.isArray(o.items)
    ? o.items
        .filter(isRecord)
        .map((i) => (typeof i.name === 'string' ? `${i.name}${typeof i.qty === 'number' ? ` x${i.qty}` : ''}` : ''))
        .filter(Boolean)
        .join(', ')
    : '';
  const total = o.amount_total !== null ? `${o.amount_total} ${o.currency ?? ''}`.trim() : '';
  return [o.created_at.slice(0, 10), `status: ${o.status}`, `payment: ${o.payment_status}`, items, total]
    .filter(Boolean)
    .join(' — ');
}

/* ----------------------------------------------------------------- lookup_tenant */

async function lookupTenant(businessName: string): Promise<string> {
  const q = businessName.trim();
  if (!q) return 'Please provide a business name to search for.';

  const supabase = await createSupabaseServerClient();
  const { data: tenants, error } = await supabase
    .from('tenants')
    .select('id, business_name, is_active, plan, plan_status, requested_platforms, daily_cost_alert_usd')
    .ilike('business_name', ilikePattern(q))
    .limit(TENANT_LIMIT);
  if (error) throw error;
  if (!tenants?.length) return `No client business matching "${q}" was found.`;

  const ids = tenants.map((t) => t.id);
  const dayStart = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();

  const [{ data: pendingRows, error: e1 }, { data: handoffRows, error: e2 }, { data: flaggedRows, error: e3 }, { data: failedRows, error: e4 }, { data: usageRows, error: e5 }] =
    await Promise.all([
      supabase.from('orders').select('tenant_id').eq('status', 'pending').in('tenant_id', ids),
      supabase.from('chat_sessions').select('tenant_id').eq('is_human_handoff', true).in('tenant_id', ids),
      supabase.from('chat_sessions').select('tenant_id').not('alert_signal', 'is', null).in('tenant_id', ids),
      supabase.from('chat_messages').select('tenant_id').eq('delivery_failed', true).in('tenant_id', ids),
      supabase.from('usage_logs').select('tenant_id, estimated_cost_usd').gte('created_at', dayStart).in('tenant_id', ids),
    ]);
  for (const e of [e1, e2, e3, e4, e5]) if (e) throw e;

  const countBy = (rows: { tenant_id: string }[] | null): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.tenant_id, (m.get(r.tenant_id) ?? 0) + 1);
    return m;
  };
  const pendingByTenant = countBy(pendingRows);
  const handoffByTenant = countBy(handoffRows);
  const flaggedByTenant = countBy(flaggedRows);
  const failedByTenant = countBy(failedRows);
  const costByTenant = new Map<string, number>();
  for (const r of usageRows ?? []) costByTenant.set(r.tenant_id, (costByTenant.get(r.tenant_id) ?? 0) + r.estimated_cost_usd);

  const lines: string[] = [];
  for (const t of tenants) {
    const cost = costByTenant.get(t.id) ?? 0;
    const cap = t.daily_cost_alert_usd;
    const flags = [t.is_active ? null : 'INACTIVE', t.plan_status && t.plan_status !== 'active' ? t.plan_status : null].filter(
      (f): f is string => Boolean(f),
    );
    const flagStr = flags.length ? ` [${flags.join(', ')}]` : '';
    lines.push(`- ${t.business_name} (plan: ${t.plan}${flagStr}, channels: ${(t.requested_platforms ?? []).join(', ') || 'none'})`);
    lines.push(
      `  ${handoffByTenant.get(t.id) ?? 0} open handoffs, ${flaggedByTenant.get(t.id) ?? 0} flagged chats, ${
        pendingByTenant.get(t.id) ?? 0
      } pending orders, ${failedByTenant.get(t.id) ?? 0} failed deliveries, today's usage $${cost.toFixed(2)}${
        cap ? ` of $${cap.toFixed(2)} cap` : ' (no cap set)'
      }.`,
    );
  }
  return lines.join('\n');
}

const lookupTenantTool: AdminCopilotTool = {
  def: {
    name: 'lookup_tenant',
    description:
      'Look up ONE specific client business by name to see its full operational status: plan, active/inactive, ' +
      "connected channels, today's AI usage vs its cost cap, and counts of open handoffs, flagged chats, pending " +
      'orders, and failed deliveries. Use this when the operator asks about a named client, e.g. "how is Sabiha ' +
      'Jewellers doing" or "is Grand Cottages active". Read-only.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['business_name'],
      properties: {
        business_name: { type: 'string', description: 'The client business name, or part of it, as the operator said it.' },
      },
    },
  },
  argsSchema: z.object({ business_name: z.string().min(1) }),
  async execute(args) {
    const a = args as { business_name: string };
    return { text: await lookupTenant(a.business_name) };
  },
};

/* --------------------------------------------------------------- lookup_customer */

async function lookupCustomer(query: string, businessName?: string): Promise<string> {
  const q = query.trim();
  if (!q) return 'Please provide a customer name or phone number to search for.';

  const supabase = await createSupabaseServerClient();

  let tenantIds: string[] | null = null;
  if (businessName?.trim()) {
    const { data: matched, error } = await supabase
      .from('tenants')
      .select('id')
      .ilike('business_name', ilikePattern(businessName.trim()))
      .limit(TENANT_LIMIT);
    if (error) throw error;
    if (!matched?.length) return `No client business matching "${businessName.trim()}" was found.`;
    tenantIds = matched.map((t) => t.id);
  }

  const pattern = ilikePattern(q);
  const sessionCols = 'id, tenant_id, customer_name, external_user_id, platform, is_human_handoff, alert_signal, summary, created_at';
  const orderCols = 'id, tenant_id, customer_name, customer_phone, status, payment_status, items, amount_total, currency, created_at';

  const scope = <T extends { in(column: string, values: readonly string[]): T }>(qb: T): T =>
    tenantIds ? qb.in('tenant_id', tenantIds) : qb;

  const [byNameSessions, byIdSessions, byNameOrders, byPhoneOrders] = await Promise.all([
    scope(supabase.from('chat_sessions').select(sessionCols).ilike('customer_name', pattern))
      .order('created_at', { ascending: false })
      .limit(LOOKUP_LIMIT),
    scope(supabase.from('chat_sessions').select(sessionCols).ilike('external_user_id', pattern))
      .order('created_at', { ascending: false })
      .limit(LOOKUP_LIMIT),
    scope(supabase.from('orders').select(orderCols).ilike('customer_name', pattern))
      .order('created_at', { ascending: false })
      .limit(LOOKUP_LIMIT),
    scope(supabase.from('orders').select(orderCols).ilike('customer_phone', pattern))
      .order('created_at', { ascending: false })
      .limit(LOOKUP_LIMIT),
  ]);
  for (const r of [byNameSessions, byIdSessions, byNameOrders, byPhoneOrders]) if (r.error) throw r.error;

  const sessionsById = new Map((byNameSessions.data ?? []).concat(byIdSessions.data ?? []).map((s) => [s.id, s]));
  const sessions = Array.from(sessionsById.values())
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, LOOKUP_LIMIT);

  const ordersById = new Map((byNameOrders.data ?? []).concat(byPhoneOrders.data ?? []).map((o) => [o.id, o]));
  const orders = Array.from(ordersById.values())
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, LOOKUP_LIMIT);

  if (!sessions.length && !orders.length) return `No customer matching "${q}" was found.`;

  const seenTenantIds = new Set<string>([...sessions.map((s) => s.tenant_id), ...orders.map((o) => o.tenant_id)]);
  const { data: tenantRows, error: tenantsError } = await supabase
    .from('tenants')
    .select('id, business_name')
    .in('id', Array.from(seenTenantIds));
  if (tenantsError) throw tenantsError;
  const businessNameById = new Map((tenantRows ?? []).map((t) => [t.id, t.business_name]));
  const nameFor = (tenantId: string) => businessNameById.get(tenantId) ?? 'unknown business';

  const lines: string[] = [];

  if (sessions.length) {
    lines.push('Chats:');
    for (const s of sessions) {
      const label = s.customer_name || s.external_user_id;
      const handoff = s.is_human_handoff ? 'handed off to a human' : 'AI handling';
      const alert = s.alert_signal ? `, alert: ${s.alert_signal}` : '';
      lines.push(`- [${nameFor(s.tenant_id)}] ${label} (${s.platform}) — ${handoff}${alert}, last active ${s.created_at.slice(0, 10)}`);
      if (s.summary) lines.push(`  summary: ${s.summary.slice(0, MESSAGE_CONTENT_CHARS)}`);
    }

    const mostRecent = sessions[0];
    if (mostRecent) {
      const { data: messages, error: messagesError } = await supabase
        .from('chat_messages')
        .select('role, content, created_at')
        .eq('tenant_id', mostRecent.tenant_id)
        .eq('session_id', mostRecent.id)
        .order('created_at', { ascending: false })
        .limit(MESSAGE_PREVIEW_LIMIT);
      if (messagesError) throw messagesError;
      if (messages?.length) {
        lines.push(`Recent messages (most recent chat, [${nameFor(mostRecent.tenant_id)}], newest first):`);
        for (const m of messages) lines.push(`  [${m.role}] ${m.content.slice(0, MESSAGE_CONTENT_CHARS)}`);
      }
    }
  }

  if (orders.length) {
    lines.push('Orders:');
    for (const o of orders)
      lines.push(`- [${nameFor(o.tenant_id)}] ${o.customer_name ?? o.customer_phone ?? 'unknown'}: ${formatOrderLine(o)}`);
  }

  return lines.join('\n');
}

const lookupCustomerTool: AdminCopilotTool = {
  def: {
    name: 'lookup_customer',
    description:
      'Look up ONE specific customer by name or phone number, across ANY client business: their recent chat ' +
      'conversations (AI-handled or handed off, any alert, a summary, and recent messages) and their recent orders ' +
      '(status, payment, items, total), each tagged with which client business it belongs to. Optionally pass ' +
      'business_name to narrow to one client if the operator named it. Use this for "what\'s going on with ' +
      'Ayesha\'s order" or "did Bilal ever reply, and where". Read-only.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', description: "The customer's name or phone number, as the operator said it." },
        business_name: { type: 'string', description: 'Optional: narrow the search to one client business by name.' },
      },
    },
  },
  argsSchema: z.object({ query: z.string().min(1), business_name: z.string().optional() }),
  async execute(args) {
    const a = args as { query: string; business_name?: string };
    return { text: await lookupCustomer(a.query, a.business_name) };
  },
};

/* ------------------------------------------------------ tenant name resolver */

interface ResolveTenantResult {
  ok: true;
  tenantId: string;
  businessName: string;
}
interface ResolveTenantError {
  ok: false;
  message: string;
}

/**
 * Resolve a business name to exactly one tenant, the "one genuinely new bit"
 * for admin write-actions (HANDOFF-followups-admin.md item 2). Never guesses:
 * zero matches or multiple matches both come back as an error string the model
 * reads and relays, asking the operator to name the client more precisely —
 * so a staged action always carries an unambiguous target.
 */
async function resolveTenantByName(businessName: string): Promise<ResolveTenantResult | ResolveTenantError> {
  const q = businessName.trim();
  if (!q) return { ok: false, message: 'Please provide a business name.' };

  const supabase = await createSupabaseServerClient();
  const { data: tenants, error } = await supabase
    .from('tenants')
    .select('id, business_name')
    .ilike('business_name', ilikePattern(q))
    .limit(TENANT_LIMIT);
  if (error) throw error;

  if (!tenants?.length) return { ok: false, message: `No client business matching "${q}" was found.` };
  if (tenants.length > 1) {
    const names = tenants.map((t) => t.business_name).join(', ');
    return { ok: false, message: `Multiple clients match "${q}": ${names}. Please say which one you mean.` };
  }

  return { ok: true, tenantId: tenants[0].id, businessName: tenants[0].business_name };
}

/* -------------------------------------------------------- write-staging tools */

const inviteTeamMemberTool: AdminCopilotTool = {
  def: {
    name: 'invite_team_member',
    description:
      'Propose inviting a new teammate to a NAMED client business by email. Role is "tenant_admin" (full access, ' +
      'same as the owner) or "tenant_agent" (works the inbox/orders, no billing/team/settings access). This only ' +
      'STAGES the invite — nothing is sent until the operator reviews and approves it as a card.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['business_name', 'email', 'role'],
      properties: {
        business_name: { type: 'string', description: 'The client business to invite this person to, as the operator said it.' },
        email: { type: 'string', description: "The teammate's email address." },
        role: {
          type: 'string',
          enum: [...MEMBER_ROLE_VALUES],
          description: '"tenant_admin" for full access, "tenant_agent" for limited access.',
        },
      },
    },
  },
  argsSchema: z.object({
    business_name: z.string().min(1),
    email: z.string().trim().email(),
    role: z.enum(MEMBER_ROLE_VALUES),
  }),
  async execute(args) {
    const a = args as { business_name: string; email: string; role: (typeof MEMBER_ROLE_VALUES)[number] };
    const resolved = await resolveTenantByName(a.business_name);
    if (!resolved.ok) return { text: resolved.message };
    const action: CopilotAction = { type: 'invite_team_member', email: a.email.trim(), role: a.role };
    return {
      text: `Staged an invite for ${a.email} to ${resolved.businessName} as ${a.role === 'tenant_admin' ? 'an admin' : 'an agent'}.`,
      staged: { action, tenantId: resolved.tenantId, businessName: resolved.businessName },
    };
  },
};

const setStockTool: AdminCopilotTool = {
  def: {
    name: 'set_stock',
    description:
      'Propose setting the exact stock count for one catalogue item, by name, for a NAMED client business, e.g. ' +
      '"set Bridal Lehenga stock to 5 for Sabiha Jewellers". Use restock instead when the operator describes an ' +
      'ADDITION rather than the exact new total. This only STAGES the change — nothing updates until the operator approves it.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['business_name', 'item_name', 'stock'],
      properties: {
        business_name: { type: 'string', description: 'The client business whose inventory this is, as the operator said it.' },
        item_name: { type: 'string', description: 'The catalogue item name, as it appears in the catalogue.' },
        stock: { type: 'integer', minimum: 0, description: 'The exact new stock count.' },
      },
    },
  },
  argsSchema: z.object({
    business_name: z.string().min(1),
    item_name: z.string().trim().min(1),
    stock: z.number().int().min(0),
  }),
  async execute(args) {
    const a = args as { business_name: string; item_name: string; stock: number };
    const resolved = await resolveTenantByName(a.business_name);
    if (!resolved.ok) return { text: resolved.message };
    const action: CopilotAction = { type: 'set_stock', itemName: a.item_name.trim(), stock: a.stock };
    return {
      text: `Staged setting "${a.item_name.trim()}" stock to ${a.stock} for ${resolved.businessName}.`,
      staged: { action, tenantId: resolved.tenantId, businessName: resolved.businessName },
    };
  },
};

const restockTool: AdminCopilotTool = {
  def: {
    name: 'restock',
    description:
      'Propose adding units to an item\'s current stock for a NAMED client business, e.g. "restock 10 more Bridal ' +
      'Lehengas for Sabiha Jewellers". Use this instead of set_stock when the operator is describing an ADDITION ' +
      'rather than stating the exact new total. This only STAGES the change — nothing updates until the operator approves it.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['business_name', 'item_name', 'add_units'],
      properties: {
        business_name: { type: 'string', description: 'The client business whose inventory this is, as the operator said it.' },
        item_name: { type: 'string', description: 'The catalogue item name, as it appears in the catalogue.' },
        add_units: { type: 'integer', minimum: 1, description: 'How many units to add to the current stock.' },
      },
    },
  },
  argsSchema: z.object({
    business_name: z.string().min(1),
    item_name: z.string().trim().min(1),
    add_units: z.number().int().positive(),
  }),
  async execute(args) {
    const a = args as { business_name: string; item_name: string; add_units: number };
    const resolved = await resolveTenantByName(a.business_name);
    if (!resolved.ok) return { text: resolved.message };
    const action: CopilotAction = { type: 'restock', itemName: a.item_name.trim(), addUnits: a.add_units };
    return {
      text: `Staged adding ${a.add_units} units to "${a.item_name.trim()}" for ${resolved.businessName}.`,
      staged: { action, tenantId: resolved.tenantId, businessName: resolved.businessName },
    };
  },
};

const ADMIN_COPILOT_TOOLS: AdminCopilotTool[] = [
  lookupTenantTool,
  lookupCustomerTool,
  inviteTeamMemberTool,
  setStockTool,
  restockTool,
];

export function getAdminCopilotToolDefs(): LlmToolDef[] {
  return ADMIN_COPILOT_TOOLS.map((t) => t.def);
}

/**
 * Parse + validate the model's args, then run the executor. Never throws — a
 * tool failure becomes an error string the model can recover from, mirroring
 * `copilot/copilotTools.ts`'s `executeCopilotTool`. Returns the full
 * `AdminToolResult` so a write tool's staged action reaches the turn action —
 * the caller decides which staged action (if any) survives to the reply.
 */
export async function executeAdminCopilotTool(call: LlmToolCall): Promise<AdminToolResult> {
  const tool = ADMIN_COPILOT_TOOLS.find((t) => t.def.name === call.name);
  if (!tool) return { text: `Unknown tool: ${call.name}` };

  let rawArgs: unknown;
  try {
    rawArgs = JSON.parse(call.arguments);
  } catch {
    return { text: 'Invalid arguments: not valid JSON.' };
  }

  const parsed = tool.argsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return { text: `Invalid arguments: ${parsed.error.issues[0]?.message ?? 'validation failed'}` };
  }

  try {
    return await tool.execute(parsed.data);
  } catch (err) {
    log.error('[admin-copilot] tool execution failed', {
      tool: call.name,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      text:
        err instanceof Error && err.message.length <= 200
          ? `That step failed: ${err.message}`
          : 'That step failed. Try a different search.',
    };
  }
}
