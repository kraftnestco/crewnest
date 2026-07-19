import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import type { Database } from '@/types/database';
import type { AlertSignal, ChatSession, Platform } from '@/types/domain';

/**
 * Session lifecycle. Uses the SERVICE client from webhook/after() context.
 * See docs/08 §5.2.
 */

type ChatSessionRow = Database['public']['Tables']['chat_sessions']['Row'];

function mapSession(row: ChatSessionRow): ChatSession {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    platform: row.platform,
    externalUserId: row.external_user_id,
    isHumanHandoff: row.is_human_handoff,
    alertSignal: (row.alert_signal as AlertSignal | null) ?? null,
  };
}

/** Find the session for (tenant, platform, external user), or create it. */
export async function findOrCreate(
  tenantId: string,
  platform: Platform,
  externalUserId: string,
): Promise<ChatSession> {
  const client = createServiceClient();

  const { data: existing, error: selectError } = await client
    .from('chat_sessions')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('platform', platform)
    .eq('external_user_id', externalUserId)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing) return mapSession(existing);

  const { data: inserted, error: insertError } = await client
    .from('chat_sessions')
    .insert({ tenant_id: tenantId, platform, external_user_id: externalUserId })
    .select('*')
    .single();

  if (insertError) {
    // Unique-constraint race: another concurrent webhook created the row first.
    if (insertError.code === '23505') {
      const { data: raced, error: raceError } = await client
        .from('chat_sessions')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('platform', platform)
        .eq('external_user_id', externalUserId)
        .single();
      if (raceError) throw raceError;
      return mapSession(raced);
    }
    throw insertError;
  }

  return mapSession(inserted);
}

/** Toggle the human-handoff flag (used by the AI on [HUMAN_HANDOFF] and by the inbox Take Over). */
export async function setHandoff(sessionId: string, value: boolean): Promise<void> {
  const client = createServiceClient();
  const { error } = await client
    .from('chat_sessions')
    .update({ is_human_handoff: value })
    .eq('id', sessionId);

  if (error) throw error;
}

/**
 * Persist the Live Inbox alert signal detected from the assistant's reply (or clear it
 * with null). Returns whether the value actually changed — `.neq()` can't express a
 * NULL→value transition correctly, so this reads-then-compares-then-writes, letting
 * callers notify only on a real transition rather than every qualifying turn.
 */
export async function setAlertSignal(sessionId: string, signal: AlertSignal | null): Promise<boolean> {
  const client = createServiceClient();

  const { data: current, error: readError } = await client
    .from('chat_sessions')
    .select('alert_signal')
    .eq('id', sessionId)
    .single();
  if (readError) throw readError;

  const changed = current.alert_signal !== signal;

  const { error } = await client
    .from('chat_sessions')
    .update({ alert_signal: signal })
    .eq('id', sessionId);
  if (error) throw error;

  return changed;
}
