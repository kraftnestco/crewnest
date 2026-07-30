import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { env } from '@/lib/env';
import { sendEmail } from '@/services/email';
import { isPushConfigured, sendPushToUsers } from '@/services/push';
import { PUSH_ELIGIBLE_TYPES } from '@/lib/constants';
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

  await emitExternalFanOut(input);
}

interface RecipientRow {
  id: string;
  email: string | null;
  notification_prefs: Database['public']['Tables']['profiles']['Row']['notification_prefs'];
}

/** A recipient has muted this type outright — applies to every sink, not just email. */
function isMuted(row: RecipientRow, type: NotificationType): boolean {
  const prefs = (row.notification_prefs ?? {}) as { muted_types?: string[] };
  return (prefs.muted_types ?? []).includes(type);
}

function emailEligible(row: RecipientRow, type: NotificationType): boolean {
  const prefs = (row.notification_prefs ?? {}) as { email_enabled?: boolean };
  return prefs.email_enabled === true && !isMuted(row, type);
}

/**
 * docs/14 §3.4 — agency recipients are every platform admin; tenant recipients
 * are that tenant's user_tenants members. Resolved ONCE per notify() and shared
 * by the email and push fan-outs, so adding push didn't double the queries.
 * Per-sink eligibility (email_enabled, muted_types) is applied by each fan-out.
 */
async function resolveRecipients(
  client: ReturnType<typeof createServiceClient>,
  input: NotifyInput,
): Promise<RecipientRow[]> {
  if (input.scope === 'agency') {
    const { data } = await client
      .from('profiles')
      .select('id, email, notification_prefs')
      .eq('is_platform_admin', true);
    return data ?? [];
  }

  const { data: members } = await client
    .from('user_tenants')
    .select('user_id')
    .eq('tenant_id', input.tenantId);
  const userIds = (members ?? []).map((m) => m.user_id);
  if (userIds.length === 0) return [];

  const { data: profiles } = await client
    .from('profiles')
    .select('id, email, notification_prefs')
    .in('id', userIds);
  return profiles ?? [];
}

/**
 * Email and push are bolt-ons, not dependencies (docs/14 §3.4/§9; docs/21 §2.5):
 * each is a no-op whenever its own env vars are unset, and both are best-effort
 * (never throw into the caller's hot path) once configured.
 *
 * Recipients are resolved once and shared by both sinks.
 */
async function emitExternalFanOut(input: NotifyInput): Promise<void> {
  const emailOn = Boolean(env.RESEND_API_KEY);
  const pushOn = isPushConfigured() && (PUSH_ELIGIBLE_TYPES as readonly string[]).includes(input.type);
  if (!emailOn && !pushOn) return;

  let recipients: RecipientRow[];
  try {
    recipients = await resolveRecipients(createServiceClient(), input);
  } catch (err) {
    log.error('[notifications] recipient lookup failed', {
      type: input.type,
      tenantId: input.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (recipients.length === 0) return;

  await Promise.all([
    emailOn ? emitEmailFanOut(input, recipients) : Promise.resolve(),
    pushOn ? emitPushFanOut(input, recipients) : Promise.resolve(),
  ]);
}

async function emitEmailFanOut(input: NotifyInput, recipients: RecipientRow[]): Promise<void> {
  try {
    const to = recipients
      .filter((row) => emailEligible(row, input.type))
      .map((row) => row.email)
      .filter((email): email is string => email !== null);
    if (to.length === 0) return;
    await sendEmail({ to, subject: input.title, text: input.body ?? input.title });
  } catch (err) {
    log.error('[notifications] email fan-out failed', {
      type: input.type,
      tenantId: input.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * docs/21 §2.2 — only PUSH_ELIGIBLE_TYPES reach here (checked by the caller),
 * and a recipient who muted the type gets no push, exactly as they get no email.
 *
 * §2.5: the payload carries NO customer PII and NO message content — just the
 * title, the short body the in-app row already shows, and the link. A push
 * lands on a lock screen, the least controlled surface in the product.
 */
async function emitPushFanOut(input: NotifyInput, recipients: RecipientRow[]): Promise<void> {
  const userIds = recipients.filter((row) => !isMuted(row, input.type)).map((row) => row.id);
  if (userIds.length === 0) return;

  await sendPushToUsers(userIds, {
    title: input.title,
    body: input.body ?? '',
    link: input.link,
    // Collapse repeats of the same event on the same entity into one buzz.
    tag: input.entityId ? `${input.type}:${input.entityId}` : input.type,
  });
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
