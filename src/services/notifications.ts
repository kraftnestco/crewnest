import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import type { Database } from '@/types/database';
import type { Notification, NotificationEntityType, NotificationType } from '@/types/domain';

/**
 * The one notification emitter (docs/14 §3.1). Called from aiOrchestrator.ts,
 * which is trigger-agnostic — imports no `next/*` — so this mirrors
 * services/sessions.ts exactly: service-role client, no `next/*`, callable from
 * the Meta webhook's after(), the website widget route, or a future pgmq consumer.
 */

type NotificationRow = Database['public']['Tables']['notifications']['Row'];

export function mapNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    scope: row.scope as Notification['scope'],
    tenantId: row.tenant_id,
    type: row.type as NotificationType,
    title: row.title,
    body: row.body,
    entityType: row.entity_type as NotificationEntityType | null,
    entityId: row.entity_id,
    link: row.link,
    isRead: row.is_read,
    createdAt: row.created_at,
  };
}

export interface NotifyInput {
  scope: 'agency' | 'tenant';
  tenantId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  entityType?: NotificationEntityType | null;
  entityId?: string | null;
  link: string;
}

/**
 * Insert one notification row (service-role). Best-effort: never throws into the
 * caller's hot path — logs and swallows, matching the owner-notify path in
 * services/tools/createOrder.ts.
 */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    const client = createServiceClient();
    const { error } = await client.from('notifications').insert({
      scope: input.scope,
      tenant_id: input.tenantId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      link: input.link,
    });
    if (error) throw error;
  } catch (err) {
    console.error('[notifications] emit failed', {
      type: input.type,
      tenantId: input.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Emit the agency + tenant rows for an event both audiences care about, each with its own copy + link. */
export async function notifyBoth(args: {
  tenantId: string;
  type: NotificationType;
  agency: { title: string; body?: string; link: string };
  tenant: { title: string; body?: string; link: string };
  entityType?: NotificationEntityType | null;
  entityId?: string | null;
}): Promise<void> {
  await Promise.all([
    notify({
      scope: 'agency',
      tenantId: args.tenantId,
      type: args.type,
      title: args.agency.title,
      body: args.agency.body,
      link: args.agency.link,
      entityType: args.entityType,
      entityId: args.entityId,
    }),
    notify({
      scope: 'tenant',
      tenantId: args.tenantId,
      type: args.type,
      title: args.tenant.title,
      body: args.tenant.body,
      link: args.tenant.link,
      entityType: args.entityType,
      entityId: args.entityId,
    }),
  ]);
}
