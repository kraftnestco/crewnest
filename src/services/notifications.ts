import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { env } from '@/lib/env';
import { sendEmail } from '@/services/email';
import type { Database } from '@/types/database';
import type { Notification, NotificationEntityType, NotificationType } from '@/types/domain';
import { log } from '@/lib/log';

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
    log.error('[notifications] emit failed', {
      type: input.type,
      tenantId: input.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  await emitEmailFanOut(input);
}

interface RecipientRow {
  email: string | null;
  notification_prefs: Database['public']['Tables']['profiles']['Row']['notification_prefs'];
}

function emailEligible(row: RecipientRow, type: NotificationType): boolean {
  const prefs = (row.notification_prefs ?? {}) as { email_enabled?: boolean; muted_types?: string[] };
  return prefs.email_enabled === true && !(prefs.muted_types ?? []).includes(type);
}

/**
 * docs/14 §3.4 — agency recipients are every platform admin; tenant recipients
 * are that tenant's user_tenants members. Both are filtered by the recipient's
 * own notification_prefs (email_enabled + muted_types) before we ever send.
 */
async function resolveEmailRecipients(client: ReturnType<typeof createServiceClient>, input: NotifyInput): Promise<string[]> {
  if (input.scope === 'agency') {
    const { data } = await client
      .from('profiles')
      .select('email, notification_prefs')
      .eq('is_platform_admin', true);
    return (data ?? [])
      .filter((row) => emailEligible(row, input.type))
      .map((row) => row.email)
      .filter((email): email is string => email !== null);
  }

  const { data: members } = await client
    .from('user_tenants')
    .select('user_id')
    .eq('tenant_id', input.tenantId);
  const userIds = (members ?? []).map((m) => m.user_id);
  if (userIds.length === 0) return [];

  const { data: profiles } = await client
    .from('profiles')
    .select('email, notification_prefs')
    .in('id', userIds);
  return (profiles ?? [])
    .filter((row) => emailEligible(row, input.type))
    .map((row) => row.email)
    .filter((email): email is string => email !== null);
}

/**
 * Email is a bolt-on, not a dependency (docs/14 §3.4/§9, Stage O7): a no-op
 * whenever RESEND_API_KEY is unset, and best-effort (never throws) once it is.
 */
async function emitEmailFanOut(input: NotifyInput): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  try {
    const client = createServiceClient();
    const recipients = await resolveEmailRecipients(client, input);
    if (recipients.length === 0) return;
    await sendEmail({ to: recipients, subject: input.title, text: input.body ?? input.title });
  } catch (err) {
    log.error('[notifications] email fan-out failed', {
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
