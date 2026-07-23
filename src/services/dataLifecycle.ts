import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { deleteTenantSecret } from '@/lib/secrets';
import { ORDER_MEDIA_BUCKET } from '@/lib/constants';
import { log } from '@/lib/log';
import type { Platform } from '@/types/domain';

/**
 * Right-to-erasure (docs/17 §4, Stage T). `[OPUS]`-frozen design: a customer is
 * the triple (tenantId, platform, externalUserId), not a row — see §4.2.
 * Storage and Vault are not FK-linked to public.*, so a DB cascade alone
 * leaves customer media in the bucket and orphans Vault secrets forever;
 * both functions below explicitly reach into those two stores before
 * touching the database rows that reference them.
 */

type ServiceClient = ReturnType<typeof createServiceClient>;

export interface ErasureResult {
  sessionsDeleted: number;
  storageObjectsDeleted: number;
  ordersScrubbed: number;
}

/**
 * §4.2 steps 1-4: delete the customer's session (+ its messages, via cascade),
 * delete their order-media storage objects, scrub PII on their orders while
 * keeping the order shell (the tenant's own transactional/financial record),
 * and write an audit row.
 */
export async function eraseCustomer(
  tenantId: string,
  platform: Platform,
  externalUserId: string,
  requestedBy?: string | null,
): Promise<ErasureResult> {
  const svc = createServiceClient();

  const { data: session, error: sessionError } = await svc
    .from('chat_sessions')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('platform', platform)
    .eq('external_user_id', externalUserId)
    .maybeSingle();
  if (sessionError) throw sessionError;

  const storageObjectsDeleted = session ? await deleteStoragePrefix(svc, `${tenantId}/${session.id}`) : 0;
  const ordersScrubbed = await scrubOrdersForCustomer(svc, tenantId, platform, externalUserId);

  let sessionsDeleted = 0;
  if (session) {
    const { error: deleteError } = await svc.from('chat_sessions').delete().eq('id', session.id);
    if (deleteError) throw deleteError;
    sessionsDeleted = 1;
  }

  await writeErasureEvent(svc, {
    tenantId,
    scope: 'customer',
    subjectPlatform: platform,
    subjectExternalUserId: externalUserId,
    requestedBy: requestedBy ?? null,
    storageObjectsDeleted,
    note: `${sessionsDeleted} session(s) deleted, ${ordersScrubbed} order(s) PII-scrubbed`,
  });

  return { sessionsDeleted, storageObjectsDeleted, ordersScrubbed };
}

/**
 * §4.2's tenant-wide equivalent (offboarding): every order-media object under
 * `<tenant_id>/` removed, every Vault secret the tenant row references
 * explicitly deleted, an audit row written, then the tenant row itself
 * deleted — the DB cascade (chat_sessions/chat_messages/orders/usage_logs/
 * user_tenants/notifications/demo_leads) does the rest (docs/17 §4.1).
 */
export async function eraseTenant(tenantId: string, requestedBy?: string | null): Promise<ErasureResult> {
  const svc = createServiceClient();

  const storageObjectsDeleted = await deleteTenantStorage(svc, tenantId);
  await deleteTenantVaultSecrets(svc, tenantId);

  await writeErasureEvent(svc, {
    tenantId,
    scope: 'tenant',
    subjectPlatform: null,
    subjectExternalUserId: null,
    requestedBy: requestedBy ?? null,
    storageObjectsDeleted,
    note: 'Tenant offboarded — Vault secrets removed; DB row deletion cascades sessions/messages/orders/usage/notifications.',
  });

  const { error: deleteError } = await svc.from('tenants').delete().eq('id', tenantId);
  if (deleteError) throw deleteError;

  return { sessionsDeleted: 0, storageObjectsDeleted, ordersScrubbed: 0 };
}

async function scrubOrdersForCustomer(
  svc: ServiceClient,
  tenantId: string,
  platform: Platform,
  externalUserId: string,
): Promise<number> {
  const { data: orders, error } = await svc
    .from('orders')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('platform', platform)
    .eq('external_user_id', externalUserId)
    .is('pii_erased_at', null);
  if (error) throw error;
  if (!orders || orders.length === 0) return 0;

  const { error: updateError } = await svc
    .from('orders')
    .update({
      customer_name: null,
      customer_phone: null,
      customer_address: null,
      pii_erased_at: new Date().toISOString(),
    })
    .in('id', orders.map((o) => o.id));
  if (updateError) throw updateError;

  return orders.length;
}

/** List + remove every object directly under a single-level prefix (`<tenant_id>/<session_id>`). */
async function deleteStoragePrefix(svc: ServiceClient, prefix: string): Promise<number> {
  const entries = await listAllStorageEntries(svc, prefix);
  const paths = entries.map((e) => `${prefix}/${e.name}`);
  if (paths.length === 0) return 0;

  const { error } = await svc.storage.from(ORDER_MEDIA_BUCKET).remove(paths);
  if (error) {
    log.error('[dataLifecycle] storage remove failed', { prefix, error: error.message });
    return 0;
  }
  return paths.length;
}

/** Two-level sweep: `<tenant_id>/` holds one "folder" per session id; remove every object under each. */
async function deleteTenantStorage(svc: ServiceClient, tenantId: string): Promise<number> {
  const sessionDirs = await listAllStorageEntries(svc, tenantId);
  let deleted = 0;
  for (const dir of sessionDirs) {
    deleted += await deleteStoragePrefix(svc, `${tenantId}/${dir.name}`);
  }
  return deleted;
}

/** Paginated `.list()` — the Storage API caps a single call, and a customer/tenant can exceed that. */
async function listAllStorageEntries(svc: ServiceClient, prefix: string): Promise<{ name: string }[]> {
  const PAGE_SIZE = 100;
  const entries: { name: string }[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await svc.storage.from(ORDER_MEDIA_BUCKET).list(prefix, { limit: PAGE_SIZE, offset });
    if (error) {
      log.error('[dataLifecycle] storage list failed', { prefix, error: error.message });
      return entries;
    }
    if (!data || data.length === 0) break;
    entries.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return entries;
}

async function deleteTenantVaultSecrets(svc: ServiceClient, tenantId: string): Promise<void> {
  const { data: tenant, error } = await svc
    .from('tenants')
    .select('openai_key_secret_id, meta_token_secret_id, whatsapp_token_secret_id, payment_key_secret_id')
    .eq('id', tenantId)
    .maybeSingle();
  if (error) throw error;
  if (!tenant) return;

  const secretIds = [
    tenant.openai_key_secret_id,
    tenant.meta_token_secret_id,
    tenant.whatsapp_token_secret_id,
    tenant.payment_key_secret_id,
  ].filter((id): id is string => id !== null);

  for (const secretId of secretIds) {
    try {
      await deleteTenantSecret(secretId);
    } catch (err) {
      // Best-effort: an orphaned Vault secret is a lesser harm than blocking
      // offboarding entirely on a transient RPC failure. Logged for follow-up.
      log.error('[dataLifecycle] vault secret delete failed', {
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

interface ErasureEventInput {
  tenantId: string;
  scope: 'customer' | 'tenant';
  subjectPlatform: Platform | null;
  subjectExternalUserId: string | null;
  requestedBy: string | null;
  storageObjectsDeleted: number;
  note: string;
}

async function writeErasureEvent(svc: ServiceClient, input: ErasureEventInput): Promise<void> {
  const { error } = await svc.from('erasure_events').insert({
    tenant_id: input.tenantId,
    scope: input.scope,
    subject_platform: input.subjectPlatform,
    subject_external_user_id: input.subjectExternalUserId,
    requested_by: input.requestedBy,
    storage_objects_deleted: input.storageObjectsDeleted,
    note: input.note,
  });
  if (error) throw error;
}
