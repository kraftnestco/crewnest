import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { notify } from '@/services/notifications';
import { ORDER_MEDIA_BUCKET, WEBHOOK_EVENTS_RETENTION_DAYS } from '@/lib/constants';
import { log } from '@/lib/log';
import type { OrderAttachment } from '@/types/domain';

/**
 * The Phase-3 daily maintenance entry point (docs/17 §3.1). One job, fanning
 * out to independent, best-effort tasks — a failure in one must not skip the
 * others. Invoked by a Vercel Cron hitting /api/cron/maintenance, NOT
 * pg_cron: the retention sweep and future erasure work need to delete real
 * Supabase Storage objects, which only the JS Storage SDK can reach — plain
 * SQL/pg_cron cannot. Doc-17 §3.1 names this as the explicit alternative to
 * pg_cron.
 *
 * Scoped out for now: `rate_limit_buckets` pruning (doc-15 §5) — that table
 * doesn't exist yet (rateLimit.ts is in-memory only); it's Stage P territory
 * and will be added to this fan-out once Stage P's migration creates it.
 */

type ServiceClient = ReturnType<typeof createServiceClient>;

interface TaskResult {
  ok: boolean;
  error?: string;
}

export interface CostAlertResult extends TaskResult {
  tenantsChecked: number;
  alertsFired: number;
}

export interface WebhookPruneResult extends TaskResult {
  deleted: number;
}

export interface RetentionSweepResult extends TaskResult {
  tenantsSwept: number;
  messagesDeleted: number;
  ordersScrubbed: number;
  storageObjectsDeleted: number;
}

export interface MaintenanceResult {
  costAlerts: CostAlertResult;
  webhookPrune: WebhookPruneResult;
  retentionSweep: RetentionSweepResult;
}

export async function runDailyMaintenance(): Promise<MaintenanceResult> {
  const svc = createServiceClient();

  const [costAlerts, webhookPrune, retentionSweep] = await Promise.all([
    scanCostAlerts(svc).catch((err) => failed<CostAlertResult>('cost-alert scan', err, { tenantsChecked: 0, alertsFired: 0 })),
    pruneWebhookEvents(svc).catch((err) => failed<WebhookPruneResult>('webhook_events prune', err, { deleted: 0 })),
    sweepMessageRetention(svc).catch((err) =>
      failed<RetentionSweepResult>('message retention sweep', err, {
        tenantsSwept: 0,
        messagesDeleted: 0,
        ordersScrubbed: 0,
        storageObjectsDeleted: 0,
      }),
    ),
  ]);

  log.info('[maintenance] daily run complete', { costAlerts, webhookPrune, retentionSweep });
  return { costAlerts, webhookPrune, retentionSweep };
}

function failed<T extends TaskResult>(task: string, err: unknown, defaults: Omit<T, 'ok' | 'error'>): T {
  const message = err instanceof Error ? err.message : String(err);
  log.error(`[maintenance] ${task} failed`, { error: message });
  return { ...defaults, ok: false, error: message } as T;
}

/** Doc-17 §3 (S3) — sum today's spend per tenant with an alert cap set; fire an agency system_alert on crossing it. */
async function scanCostAlerts(svc: ServiceClient): Promise<CostAlertResult> {
  const { data: tenants, error: tenantsError } = await svc
    .from('tenants')
    .select('id, business_name, daily_cost_alert_usd')
    .not('daily_cost_alert_usd', 'is', null);
  if (tenantsError) throw tenantsError;
  if (!tenants || tenants.length === 0) return { ok: true, tenantsChecked: 0, alertsFired: 0 };

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);

  let alertsFired = 0;
  for (const tenant of tenants) {
    const cap = tenant.daily_cost_alert_usd;
    if (cap === null) continue;

    const { data: usage, error: usageError } = await svc
      .from('usage_logs')
      .select('estimated_cost_usd, used_byok')
      .eq('tenant_id', tenant.id)
      .gte('created_at', dayStart.toISOString());
    if (usageError) {
      log.error('[maintenance] cost-alert usage query failed', { tenantId: tenant.id, error: usageError.message });
      continue;
    }

    const rows = usage ?? [];
    const totalUsd = rows.reduce((sum, r) => sum + r.estimated_cost_usd, 0);
    if (totalUsd < cap) continue;

    const masterKeyUsd = rows.filter((r) => !r.used_byok).reduce((sum, r) => sum + r.estimated_cost_usd, 0);
    await notify({
      scope: 'agency',
      tenantId: tenant.id,
      type: 'system_alert',
      title: `${tenant.business_name} spent $${totalUsd.toFixed(2)} today (cap $${cap.toFixed(2)})`,
      body:
        masterKeyUsd > 0
          ? `$${masterKeyUsd.toFixed(2)} of that was on the shared master key — check for a runaway loop or abuse burst.`
          : undefined,
      entityType: 'tenant',
      entityId: tenant.id,
      link: `/admin/clients/${tenant.id}`,
    });
    alertsFired += 1;
  }

  return { ok: true, tenantsChecked: tenants.length, alertsFired };
}

/** Doc-17 §4.3 — platform-level short retention, independent of any tenant setting. Meta won't redeliver this far back. */
async function pruneWebhookEvents(svc: ServiceClient): Promise<WebhookPruneResult> {
  const cutoff = new Date(Date.now() - WEBHOOK_EVENTS_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await svc.from('webhook_events').delete().lt('received_at', cutoff).select('id');
  if (error) throw error;
  return { ok: true, deleted: data?.length ?? 0 };
}

/**
 * Doc-17 §4.3 — per-tenant proactive minimisation. For each tenant with
 * message_retention_days set: hard-delete chat_messages older than the
 * window, delete their order-media storage objects (unless a still-retained
 * order also references the same object — that keeps an order's own attached
 * photo intact for the tenant's records), and scrub PII on orders past the
 * same window while keeping the order shell (docs/17 §4.2's scrub-and-retain
 * policy, reused here rather than duplicated).
 */
async function sweepMessageRetention(svc: ServiceClient): Promise<RetentionSweepResult> {
  const { data: tenants, error: tenantsError } = await svc
    .from('tenants')
    .select('id, message_retention_days')
    .not('message_retention_days', 'is', null);
  if (tenantsError) throw tenantsError;
  if (!tenants || tenants.length === 0) {
    return { ok: true, tenantsSwept: 0, messagesDeleted: 0, ordersScrubbed: 0, storageObjectsDeleted: 0 };
  }

  let messagesDeleted = 0;
  let ordersScrubbed = 0;
  let storageObjectsDeleted = 0;

  for (const tenant of tenants) {
    const days = tenant.message_retention_days;
    if (days === null) continue;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data: oldMessages, error: messagesError } = await svc
      .from('chat_messages')
      .select('id, attachments')
      .eq('tenant_id', tenant.id)
      .lt('created_at', cutoff);
    if (messagesError) {
      log.error('[maintenance] retention message query failed', { tenantId: tenant.id, error: messagesError.message });
      continue;
    }

    if (oldMessages && oldMessages.length > 0) {
      const attachmentPaths = new Set<string>();
      for (const msg of oldMessages) {
        for (const att of (msg.attachments as OrderAttachment[] | null) ?? []) {
          if (att?.storagePath) attachmentPaths.add(att.storagePath);
        }
      }

      if (attachmentPaths.size > 0) {
        const stillReferenced = await orderAttachmentPaths(svc, tenant.id);
        const toDelete = [...attachmentPaths].filter((p) => !stillReferenced.has(p));
        if (toDelete.length > 0) {
          const { error: removeError } = await svc.storage.from(ORDER_MEDIA_BUCKET).remove(toDelete);
          if (removeError) {
            log.error('[maintenance] retention storage remove failed', { tenantId: tenant.id, error: removeError.message });
          } else {
            storageObjectsDeleted += toDelete.length;
          }
        }
      }

      const { error: deleteError } = await svc
        .from('chat_messages')
        .delete()
        .in('id', oldMessages.map((m) => m.id));
      if (deleteError) {
        log.error('[maintenance] retention message delete failed', { tenantId: tenant.id, error: deleteError.message });
      } else {
        messagesDeleted += oldMessages.length;
      }
    }

    const { data: staleOrders, error: staleOrdersError } = await svc
      .from('orders')
      .select('id')
      .eq('tenant_id', tenant.id)
      .lt('created_at', cutoff)
      .is('pii_erased_at', null);
    if (staleOrdersError) {
      log.error('[maintenance] retention order query failed', { tenantId: tenant.id, error: staleOrdersError.message });
      continue;
    }
    if (staleOrders && staleOrders.length > 0) {
      const { error: scrubError } = await svc
        .from('orders')
        .update({
          customer_name: null,
          customer_phone: null,
          customer_address: null,
          pii_erased_at: new Date().toISOString(),
        })
        .in('id', staleOrders.map((o) => o.id));
      if (scrubError) {
        log.error('[maintenance] retention order scrub failed', { tenantId: tenant.id, error: scrubError.message });
      } else {
        ordersScrubbed += staleOrders.length;
      }
    }
  }

  return { ok: true, tenantsSwept: tenants.length, messagesDeleted, ordersScrubbed, storageObjectsDeleted };
}

/** Every storage path still referenced by a tenant's orders (attachments + payment proof) — never delete these out from under a kept order. */
async function orderAttachmentPaths(svc: ServiceClient, tenantId: string): Promise<Set<string>> {
  const { data, error } = await svc.from('orders').select('attachments, payment_proof').eq('tenant_id', tenantId);
  if (error) {
    log.error('[maintenance] order attachment lookup failed', { tenantId, error: error.message });
    return new Set();
  }

  const paths = new Set<string>();
  for (const order of data ?? []) {
    for (const att of (order.attachments as OrderAttachment[] | null) ?? []) {
      if (att?.storagePath) paths.add(att.storagePath);
    }
    const proof = order.payment_proof as OrderAttachment | null;
    if (proof?.storagePath) paths.add(proof.storagePath);
  }
  return paths;
}
