import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import type { ChatSession, Platform } from '@/types/domain';

/**
 * Session lifecycle. Uses the SERVICE client from webhook/after() context.
 * TODO(sonnet): implement against generated types. See docs/08 §5.2.
 */

/** Find the session for (tenant, platform, external user), or create it. */
export async function findOrCreate(
  tenantId: string,
  platform: Platform,
  externalUserId: string,
): Promise<ChatSession> {
  // Upsert on the unique (tenant_id, platform, external_user_id) constraint,
  // or select-then-insert. Return the mapped ChatSession.
  void createServiceClient();
  void tenantId;
  void platform;
  void externalUserId;
  throw new Error('TODO(sonnet): implement findOrCreate (see docs/08 §5.2)');
}

/** Toggle the human-handoff flag (used by the AI on [HUMAN_HANDOFF] and by the inbox Take Over). */
export async function setHandoff(sessionId: string, value: boolean): Promise<void> {
  void createServiceClient();
  void sessionId;
  void value;
  throw new Error('TODO(sonnet): implement setHandoff (see docs/08 §5.2)');
}
