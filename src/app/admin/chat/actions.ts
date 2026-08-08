'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import * as tenants from '@/services/tenants';
import * as aiOrchestrator from '@/services/aiOrchestrator';
import { eraseCustomer } from '@/services/dataLifecycle';
import * as sessions from '@/services/sessions';
import { getCallerContext } from '@/lib/auth/context';
import { sendText } from '@/services/meta/send';
import * as media from '@/services/meta/media';
import type { Database } from '@/types/database';
import type { OrderAttachment, PendingClarification } from '@/types/domain';
import { log } from '@/lib/log';

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

  // Resume-context nudge (docs: order-event-messaging plan, Phase D) — only on the
  // human -> AI handback ("Resume AI"), and best-effort: a failed insert must never
  // block the toggle itself.
  if (!value) {
    try {
      const { data: session } = await supabase.from('chat_sessions').select('tenant_id').eq('id', sessionId).single();
      if (session) {
        await supabase.from('chat_messages').insert({
          session_id: sessionId,
          tenant_id: session.tenant_id,
          role: 'system',
          content:
            '[context] A human agent handled the conversation above. If an order was clearly agreed but not yet ' +
            'recorded, call create_order now using the details already discussed instead of re-asking the customer.',
          authored_by: 'system',
        });
      }
    } catch (err) {
      log.error('[chat] resume-context nudge failed', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  revalidatePath('/admin/chat');
}

export async function manualSendAction(sessionId: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  const supabase = await createSupabaseServerClient();

  // RLS-scoped read also acts as the access check: no row back means no access.
  const { data: session, error: sessionError } = await supabase
    .from('chat_sessions')
    .select('id, tenant_id, platform, external_user_id, pending_clarification')
    .eq('id', sessionId)
    .single();

  if (sessionError || !session) {
    throw new Error(sessionError?.message ?? 'Session not found.');
  }

  // A human replying directly in the chat box is itself a valid resolution path for an
  // open clarification (docs: media-handoff plan, B8) — best-effort, must never block the send.
  if (session.pending_clarification) {
    try {
      const { error } = await supabase.from('chat_sessions').update({ pending_clarification: null }).eq('id', sessionId);
      if (error) throw error;
    } catch (err) {
      log.error('[chat] failed to clear pending_clarification on manual send', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const { data: inserted, error: insertError } = await supabase
    .from('chat_messages')
    .insert({
      session_id: session.id,
      tenant_id: session.tenant_id,
      role: 'assistant',
      content: trimmed,
      authored_by: 'human',
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
        log.error('[chat] manual send failed', {
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

/**
 * Server-authoritative unread reset when staff actually opens a conversation (docs/18 §4
 * finding #9) — the inbox already zeroes `unread_count` locally on select for instant
 * feedback; this persists it. RLS-scoped read is the access check, same shape as every
 * other action here: no row back means no access. Best-effort by design: called from a
 * UI click, not a form — a failure here shouldn't surface as an error toast, just a stale
 * badge until the next successful open.
 */
export async function markReadAction(sessionId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data: session, error } = await supabase
    .from('chat_sessions')
    .select('id')
    .eq('id', sessionId)
    .single();

  if (error || !session) return;

  try {
    await sessions.markRead(sessionId);
  } catch (err) {
    log.error('[chat] markRead failed', { sessionId, error: err instanceof Error ? err.message : String(err) });
  }
}

/** Human-facing label for what kind of media a resolved clarification was about (docs: media-handoff plan, B8). */
const CLARIFICATION_KIND_PHRASES: Record<PendingClarification['kind'], string> = {
  voice_review: 'the voice note',
  video_review: 'the video',
  image_ambiguous: 'the photo',
};

/**
 * A human answers an open voice/video/image clarification from the panel — clears the
 * pending pointer and hands control straight back to the AI, which replies to the
 * customer immediately using the answer, no further customer message required
 * (docs: media-handoff plan, B7/B8). Mirrors manualSendAction's RLS-scoped access
 * check: no row back means no access.
 */
export async function resolveClarificationAction(sessionId: string, note: string): Promise<void> {
  const trimmed = note.trim();
  if (!trimmed) return;

  const supabase = await createSupabaseServerClient();

  const { data: session, error: sessionError } = await supabase
    .from('chat_sessions')
    .select('id, pending_clarification')
    .eq('id', sessionId)
    .single();

  if (sessionError || !session) {
    throw new Error(sessionError?.message ?? 'Session not found.');
  }

  const pending = session.pending_clarification as unknown as PendingClarification | null;
  const phrase = pending ? CLARIFICATION_KIND_PHRASES[pending.kind] : 'this';
  const formattedNote =
    `[context] Staff reviewed ${phrase} and answered: "${trimmed}". Use this to reply to the customer now — ` +
    'do not ask them to repeat what they already sent.';

  const { error: clearError } = await supabase
    .from('chat_sessions')
    .update({ pending_clarification: null, is_human_handoff: false })
    .eq('id', sessionId);

  if (clearError) throw new Error(clearError.message);

  // Best-effort: the resolution itself has already succeeded (pointer cleared, control
  // handed back) by this point — an AI-turn failure here shouldn't be reported as this
  // action having failed, only logged, same as manualSendAction's delivery-failure path.
  try {
    await aiOrchestrator.continueSession(sessionId, formattedNote, 'human');
  } catch (err) {
    log.error('[chat] continueSession failed after resolving clarification', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  revalidatePath('/admin/chat');
  revalidatePath('/dashboard/chat');
}

/**
 * "Let the AI continue this chat" — the non-destructive recovery for a session
 * the free-plan conversation-length cap handed off (docs/27 §7A F3). Before
 * this action existed, the only thing that actually un-stuck a capped session
 * was Erase customer data: the length check re-fires on every message because
 * it counts EVERY user message in the session, so flipping the take-over
 * switch back off did nothing — the very next customer message re-tripped it
 * before the AI got a turn.
 *
 * Scoped to `handoff_cause === 'length_limit'` deliberately: a session handed
 * off for any OTHER reason (requested, alert, tool_exhaustion, media_review)
 * must not be silently resumed by this button — those need the ordinary
 * Human takeover toggle, which stays exactly as lying-free as it already is
 * for them. RLS-scoped read is the access check, same shape as every other
 * action here: no row back means no access.
 */
export async function resumeAfterLengthLimitAction(sessionId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const { data: session, error: sessionError } = await supabase
    .from('chat_sessions')
    .select('id, handoff_cause')
    .eq('id', sessionId)
    .single();

  if (sessionError || !session) {
    throw new Error(sessionError?.message ?? 'Session not found.');
  }
  if (session.handoff_cause !== 'length_limit') return; // nothing to resume — refuse rather than clobber a different handoff

  const { error: updateError } = await supabase
    .from('chat_sessions')
    .update({
      is_human_handoff: false,
      handoff_cause: null,
      // Everything from here counts toward a FRESH cap, not an unlimited one —
      // countUserMessages(sessionId, lengthLimitResetAt) only counts messages
      // after this timestamp. Hitting the cap again re-triggers this same
      // banner, requiring the owner to notice and act again rather than
      // silently converting the conversation to unlimited length.
      length_limit_reset_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  if (updateError) throw new Error(updateError.message);

  // Best-effort, same shape as resolveClarificationAction just above: the
  // reset itself already succeeded by this point, so a reply failure here is
  // logged, not surfaced as this action having failed. Runs the AI turn
  // immediately rather than waiting for the customer to send something new —
  // there may already be an unanswered message sitting from while this
  // session was stuck in handoff.
  try {
    await aiOrchestrator.continueSession(
      sessionId,
      '[context] Staff reset this chat past the message-length limit and asked you to continue. Reply to whatever the customer said most recently — do not re-greet or restart the conversation.',
      'human',
    );
  } catch (err) {
    log.error('[chat] continueSession failed after length-limit reset', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  revalidatePath('/admin/chat');
  revalidatePath('/dashboard/chat');
}

/**
 * Mint a short-TTL signed URL for the media attached to a session's OPEN clarification.
 * Takes the session id, not a bare storage path — verifies the path actually matches
 * the session's own `pending_clarification` before signing (same ownership-check shape
 * as getMessageMediaUrlAction, docs/10 §7).
 */
export async function getClarificationMediaUrlAction(sessionId: string, storagePath: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data: session, error } = await supabase
    .from('chat_sessions')
    .select('id, pending_clarification')
    .eq('id', sessionId)
    .single();

  if (error || !session) return null;

  const pending = session.pending_clarification as unknown as PendingClarification | null;
  if (!pending?.attachmentStoragePath || pending.attachmentStoragePath !== storagePath) return null;

  return media.getSignedUrl(storagePath);
}

/**
 * Right-to-erasure for a single customer (docs/17 §4.2, Stage T): deletes their session
 * (cascades chat_messages), their order-media storage objects, and scrubs PII on their
 * orders while keeping the order shell for the tenant's own records. RLS-scoped read is
 * the access check, same shape as every other action here: no row back means no access.
 * The session-row delete propagates to both inbox views via their existing Realtime
 * `chat_sessions` DELETE handler — no extra client-side cleanup needed.
 */
export async function eraseCustomerAction(sessionId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data: session, error } = await supabase
    .from('chat_sessions')
    .select('id, tenant_id, platform, external_user_id')
    .eq('id', sessionId)
    .single();

  if (error || !session) {
    throw new Error(error?.message ?? 'Session not found.');
  }

  const ctx = await getCallerContext();
  await eraseCustomer(session.tenant_id, session.platform, session.external_user_id, ctx?.userId ?? null);

  revalidatePath('/admin/chat');
  revalidatePath('/dashboard/chat');
}
