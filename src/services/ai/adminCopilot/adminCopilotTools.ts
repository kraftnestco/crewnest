import 'server-only';
import { z } from 'zod';
import type { LlmToolCall, LlmToolDef } from '@/services/ai/provider';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { log } from '@/lib/log';

/**
 * Admin Copilot tools (docs/20 Part 2). Mirrors `copilot/copilotTools.ts` in shape
 * (`{ def, argsSchema, execute }`) but every tool here is READ-ONLY and platform-
 * wide — there is no draft, nothing is staged, nothing is ever written. This is
 * the on-demand half of the admin copilot: `buildAdminSnapshot.ts` still supplies
 * the always-loaded agency-wide overview; these tools let the operator drill into
 * ONE named client or customer without that detail sitting in every turn's prompt.
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
 * existing access, not a new privilege. Still zero write tools of any kind.
 */

export interface AdminCopilotTool {
  def: LlmToolDef;
  argsSchema: z.ZodTypeAny;
  execute(args: unknown): Promise<string>;
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
    return lookupTenant(a.business_name);
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
    return lookupCustomer(a.query, a.business_name);
  },
};

const ADMIN_COPILOT_TOOLS: AdminCopilotTool[] = [lookupTenantTool, lookupCustomerTool];

export function getAdminCopilotToolDefs(): LlmToolDef[] {
  return ADMIN_COPILOT_TOOLS.map((t) => t.def);
}

/**
 * Parse + validate the model's args, then run the (read-only) executor. Never
 * throws — a tool failure becomes an error string the model can recover from,
 * mirroring `copilot/copilotTools.ts`'s `executeCopilotTool`.
 */
export async function executeAdminCopilotTool(call: LlmToolCall): Promise<string> {
  const tool = ADMIN_COPILOT_TOOLS.find((t) => t.def.name === call.name);
  if (!tool) return `Unknown tool: ${call.name}`;

  let rawArgs: unknown;
  try {
    rawArgs = JSON.parse(call.arguments);
  } catch {
    return 'Invalid arguments: not valid JSON.';
  }

  const parsed = tool.argsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return `Invalid arguments: ${parsed.error.issues[0]?.message ?? 'validation failed'}`;
  }

  try {
    return await tool.execute(parsed.data);
  } catch (err) {
    log.error('[admin-copilot] tool execution failed', {
      tool: call.name,
      error: err instanceof Error ? err.message : String(err),
    });
    return err instanceof Error && err.message.length <= 200
      ? `That lookup failed: ${err.message}`
      : 'That lookup failed. Try a different search.';
  }
}
