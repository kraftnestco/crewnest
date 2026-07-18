'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import * as tenants from '@/services/tenants';
import { sendText } from '@/services/meta/send';
import * as media from '@/services/meta/media';
import type { Database } from '@/types/database';
import type { OrderAttachment } from '@/types/domain';

type MessageRow = Database['public']['Tables']['chat_messages']['Row'];

/**
 * The browser Supabase client never holds a real session (auth cookies are
 * HttpOnly, docs/02-SECURITY.md §3), so its `.from()` calls run as the `anon`
 * role and RLS (scoped `to authenticated`) silently returns zero rows. History
 * loads must go through a server action using the RLS-authenticated server client.
 */
export async function getMessagesAction(sessionId: string): Promise<MessageRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Mint a short-TTL signed URL for a message attachment. Takes the message id, not
 * a bare storage path — a client that can read SOME message could otherwise pass
 * an arbitrary path belonging to a different tenant's private media. We do an
 * RLS-authenticated read of THIS row and verify the path is actually one of its
 * own attachments before signing (docs/10 §7).
 */
export async function getMessageMediaUrlAction(messageId: string, storagePath: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data: row, error } = await supabase
    .from('chat_messages')
    .select('id, attachments')
    .eq('id', messageId)
    .single();

  if (error || !row) return null;

  const attachments = (row.attachments as unknown as OrderAttachment[] | null) ?? [];
  const owned = attachments.some((a) => a.storagePath === storagePath);
  if (!owned) return null;

  return media.getSignedUrl(storagePath);
}

export async function takeOverAction(sessionId: string, value: boolean): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('chat_sessions')
    .update({ is_human_handoff: value })
    .eq('id', sessionId);

  if (error) throw new Error(error.message);
  revalidatePath('/admin/chat');
}

export async function manualSendAction(sessionId: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  const supabase = await createSupabaseServerClient();

  // RLS-scoped read also acts as the access check: no row back means no access.
  const { data: session, error: sessionError } = await supabase
    .from('chat_sessions')
    .select('id, tenant_id, platform, external_user_id')
    .eq('id', sessionId)
    .single();

  if (sessionError || !session) {
    throw new Error(sessionError?.message ?? 'Session not found.');
  }

  const { data: inserted, error: insertError } = await supabase
    .from('chat_messages')
    .insert({
      session_id: session.id,
      tenant_id: session.tenant_id,
      role: 'assistant',
      content: trimmed,
    })
    .select('id')
    .single();

  if (insertError) throw new Error(insertError.message);

  if (session.platform !== 'web') {
    const tenant = await tenants.getById(session.tenant_id);
    if (tenant) {
      try {
        await sendText({ tenant, platform: session.platform, to: session.external_user_id, text: trimmed });
      } catch (err) {
        console.error('[chat] manual send failed', {
          sessionId: session.id,
          error: err instanceof Error ? err.message : String(err),
        });
        if (inserted?.id) {
          await supabase.from('chat_messages').update({ delivery_failed: true }).eq('id', inserted.id);
        }
      }
    }
  }
}
