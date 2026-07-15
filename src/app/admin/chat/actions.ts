'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import * as tenants from '@/services/tenants';
import { sendText } from '@/services/meta/send';

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

  const { error: insertError } = await supabase.from('chat_messages').insert({
    session_id: session.id,
    tenant_id: session.tenant_id,
    role: 'assistant',
    content: trimmed,
  });

  if (insertError) throw new Error(insertError.message);

  if (session.platform !== 'web') {
    const tenant = await tenants.getById(session.tenant_id);
    if (tenant) {
      await sendText({ tenant, platform: session.platform, to: session.external_user_id, text: trimmed });
    }
  }
}
