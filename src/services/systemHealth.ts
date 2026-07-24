import { createSupabaseServerClient } from '@/lib/supabase/server';
import { mapNotification } from '@/services/notifications';
import type { AlertSignal } from '@/types/domain';
import type { Notification } from '@/types/domain';

export interface FailedDeliveryRow {
  id: string;
  sessionId: string;
  tenantId: string;
  tenantName: string;
  createdAt: string;
}

export interface SystemHealthSummary {
  failedDeliveries: number;
  costAlertsUnread: number;
  unhappyCustomers: number;
  alertBreakdown: Record<AlertSignal, number>;
  failedPayments: number;
  recentFailedDeliveries: FailedDeliveryRow[];
  recentCostAlerts: Notification[];
  updatedAt: string;
}

const ALERT_SIGNALS: AlertSignal[] = ['frustrated', 'price_objection', 'product_doubt', 'cancellation_risk'];

/**
 * docs/20 Part 1 — mirrors services/overview.ts: RLS server client (platform
 * admin sees every tenant), all counts in one Promise.all, Server-Component-only
 * caller. Pure aggregation over existing columns — no new table, no migration.
 *
 * TODO(0029): add blocked-sends + webhook dead-letter cards once 0029 is applied.
 */
export async function getSystemHealth(): Promise<SystemHealthSummary> {
  const supabase = await createSupabaseServerClient();

  const [
    { count: failedDeliveries },
    { data: failedDeliveryRows },
    { count: costAlertsUnread },
    { data: costAlertRows },
    alertCounts,
    { count: failedPayments },
  ] = await Promise.all([
    supabase.from('chat_messages').select('*', { count: 'exact', head: true }).eq('delivery_failed', true),
    supabase
      .from('chat_messages')
      .select('id, session_id, tenant_id, created_at')
      .eq('delivery_failed', true)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('scope', 'agency')
      .eq('type', 'system_alert')
      .eq('is_read', false),
    supabase
      .from('notifications')
      .select('*')
      .eq('scope', 'agency')
      .eq('type', 'system_alert')
      .order('created_at', { ascending: false })
      .limit(20),
    Promise.all(
      ALERT_SIGNALS.map((signal) =>
        supabase.from('chat_sessions').select('*', { count: 'exact', head: true }).eq('alert_signal', signal),
      ),
    ),
    supabase.from('orders').select('*', { count: 'exact', head: true }).eq('payment_status', 'failed'),
  ]);

  const alertBreakdown = ALERT_SIGNALS.reduce(
    (acc, signal, i) => {
      acc[signal] = alertCounts[i].count ?? 0;
      return acc;
    },
    {} as Record<AlertSignal, number>,
  );
  const unhappyCustomers = ALERT_SIGNALS.reduce((sum, signal) => sum + alertBreakdown[signal], 0);

  const tenantIds = [...new Set((failedDeliveryRows ?? []).map((r) => r.tenant_id))];
  const { data: tenantRows } =
    tenantIds.length > 0
      ? await supabase.from('tenants').select('id, business_name').in('id', tenantIds)
      : { data: [] };
  const tenantNameById = new Map((tenantRows ?? []).map((t) => [t.id, t.business_name]));

  return {
    failedDeliveries: failedDeliveries ?? 0,
    costAlertsUnread: costAlertsUnread ?? 0,
    unhappyCustomers,
    alertBreakdown,
    failedPayments: failedPayments ?? 0,
    recentFailedDeliveries: (failedDeliveryRows ?? []).map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      tenantId: r.tenant_id,
      tenantName: tenantNameById.get(r.tenant_id) ?? 'Unknown',
      createdAt: r.created_at,
    })),
    recentCostAlerts: (costAlertRows ?? []).map(mapNotification),
    updatedAt: new Date().toISOString(),
  };
}
