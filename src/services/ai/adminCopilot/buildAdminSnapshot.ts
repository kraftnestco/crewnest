import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSystemHealth } from '@/services/systemHealth';

/**
 * Admin Copilot snapshot builder (docs/20 §2.2). Assembles the ONLY data the
 * admin copilot ever sees — a compact plain-text block built from an explicit
 * column allowlist, never `select('*')`. No secrets, no customer PII, no raw
 * message/order content (docs/20 §2.1.3-4). The model has no tools, so this
 * string is its entire world; nothing it can ask for reaches beyond it.
 */

interface TenantOpsRow {
  businessName: string;
  isActive: boolean;
  plan: string;
  planStatus: string | null;
  requestedPlatforms: string[];
  dailyCostAlertUsd: number | null;
  todayCostUsd: number;
  openHandoffs: number;
  flaggedChats: number;
  pendingOrders: number;
  failedDeliveries: number;
}

const SHOWN_CAP = 50;

function costRatio(row: Pick<TenantOpsRow, 'dailyCostAlertUsd' | 'todayCostUsd'>): number {
  return row.dailyCostAlertUsd && row.dailyCostAlertUsd > 0 ? row.todayCostUsd / row.dailyCostAlertUsd : 0;
}

function isLive(row: TenantOpsRow): boolean {
  return row.openHandoffs + row.flaggedChats + row.pendingOrders + row.failedDeliveries > 0 || costRatio(row) >= 0.8;
}

function urgency(row: TenantOpsRow): number {
  const ratio = costRatio(row);
  return (
    row.failedDeliveries * 3 +
    row.flaggedChats * 3 +
    row.openHandoffs * 2 +
    row.pendingOrders +
    (ratio >= 1 ? 6 : ratio >= 0.8 ? 3 : 0)
  );
}

function countByTenant(rows: { tenant_id: string }[] | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows ?? []) m.set(r.tenant_id, (m.get(r.tenant_id) ?? 0) + 1);
  return m;
}

function describeTenant(row: TenantOpsRow): string {
  const bits = [
    `${row.openHandoffs} open handoff${row.openHandoffs === 1 ? '' : 's'}`,
    `${row.flaggedChats} flagged chat${row.flaggedChats === 1 ? '' : 's'}`,
    `${row.pendingOrders} pending order${row.pendingOrders === 1 ? '' : 's'}`,
    `${row.failedDeliveries} failed deliver${row.failedDeliveries === 1 ? 'y' : 'ies'}`,
    row.dailyCostAlertUsd
      ? `today's usage $${row.todayCostUsd.toFixed(2)} of $${row.dailyCostAlertUsd.toFixed(2)} cap`
      : `today's usage $${row.todayCostUsd.toFixed(2)} (no cap set)`,
  ];
  const flags = [row.isActive ? null : 'INACTIVE', row.planStatus && row.planStatus !== 'active' ? row.planStatus : null]
    .filter((f): f is string => Boolean(f));
  const flagStr = flags.length ? ` [${flags.join(', ')}]` : '';
  return `- ${row.businessName} (plan: ${row.plan}${flagStr}) — ${bits.join(', ')}`;
}

export async function buildAdminSnapshot(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const dayStart = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();

  const [
    health,
    { data: tenants },
    { data: pendingOrderRows },
    { data: handoffRows },
    { data: flaggedRows },
    { data: failedDeliveryRows },
    { data: usageRows },
  ] = await Promise.all([
    getSystemHealth(),
    supabase
      .from('tenants')
      .select('id, business_name, is_active, plan, plan_status, requested_platforms, daily_cost_alert_usd'),
    supabase.from('orders').select('tenant_id').eq('status', 'pending'),
    supabase.from('chat_sessions').select('tenant_id').eq('is_human_handoff', true),
    supabase.from('chat_sessions').select('tenant_id').not('alert_signal', 'is', null),
    supabase.from('chat_messages').select('tenant_id').eq('delivery_failed', true),
    supabase.from('usage_logs').select('tenant_id, estimated_cost_usd').gte('created_at', dayStart),
  ]);

  const pendingByTenant = countByTenant(pendingOrderRows);
  const handoffByTenant = countByTenant(handoffRows);
  const flaggedByTenant = countByTenant(flaggedRows);
  const failedByTenant = countByTenant(failedDeliveryRows);
  const costByTenant = new Map<string, number>();
  for (const r of usageRows ?? []) costByTenant.set(r.tenant_id, (costByTenant.get(r.tenant_id) ?? 0) + r.estimated_cost_usd);

  const rows: TenantOpsRow[] = (tenants ?? []).map((t) => ({
    businessName: t.business_name,
    isActive: t.is_active,
    plan: t.plan,
    planStatus: t.plan_status,
    requestedPlatforms: t.requested_platforms ?? [],
    dailyCostAlertUsd: t.daily_cost_alert_usd,
    todayCostUsd: costByTenant.get(t.id) ?? 0,
    openHandoffs: handoffByTenant.get(t.id) ?? 0,
    flaggedChats: flaggedByTenant.get(t.id) ?? 0,
    pendingOrders: pendingByTenant.get(t.id) ?? 0,
    failedDeliveries: failedByTenant.get(t.id) ?? 0,
  }));

  const liveRows = rows.filter(isLive).sort((a, b) => urgency(b) - urgency(a));
  const shown = liveRows.slice(0, SHOWN_CAP);
  const overflow = liveRows.length - shown.length;
  const quiet = rows.length - liveRows.length;

  const lines: string[] = [];
  lines.push('AGENCY-WIDE TOTALS');
  lines.push(`- Failed deliveries: ${health.failedDeliveries}`);
  lines.push(`- Failed payments: ${health.failedPayments}`);
  lines.push(
    `- Unhappy customers: ${health.unhappyCustomers} (frustrated: ${health.alertBreakdown.frustrated}, price objection: ${health.alertBreakdown.price_objection}, product doubt: ${health.alertBreakdown.product_doubt}, cancellation risk: ${health.alertBreakdown.cancellation_risk})`,
  );
  lines.push(`- Unread cost-cap alerts: ${health.costAlertsUnread}`);
  lines.push('');

  lines.push(`CLIENTS NEEDING ATTENTION (${shown.length} shown, ordered most urgent first)`);
  if (shown.length === 0) {
    lines.push('- None. Every client is quiet right now.');
  } else {
    for (const row of shown) lines.push(describeTenant(row));
  }
  if (overflow > 0) lines.push(`+${overflow} more client${overflow === 1 ? '' : 's'} also need attention (not shown — see /admin/clients or /admin/health).`);
  if (quiet > 0) lines.push(`+${quiet} more client${quiet === 1 ? '' : 's'}, all quiet.`);
  lines.push('');

  lines.push('RECENT COST-CAP ALERTS');
  if (health.recentCostAlerts.length === 0) {
    lines.push('- None.');
  } else {
    for (const n of health.recentCostAlerts.slice(0, 10)) {
      lines.push(`- ${n.title} (${new Date(n.createdAt).toLocaleString()})`);
    }
  }

  return lines.join('\n');
}
