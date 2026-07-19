'use server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCallerContext } from '@/lib/auth/context';
import type { NotificationPrefs, NotificationType } from '@/types/domain';

const KNOWN_TYPES: NotificationType[] = ['new_order', 'handoff', 'alert_signal', 'channel_request', 'payment_proof'];

/** RLS (`profiles_update`, migration 0006) lets a caller update only their own row — `.eq('id', …)` is belt-and-suspenders. */
export async function updateFullNameAction(fullName: string): Promise<void> {
  const ctx = await getCallerContext();
  if (!ctx) throw new Error('Not signed in.');

  const trimmed = fullName.trim();
  if (!trimmed) throw new Error('Full name is required.');

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('profiles').update({ full_name: trimmed }).eq('id', ctx.userId);
  if (error) throw new Error(error.message);
}

export async function updateNotificationPrefsAction(prefs: NotificationPrefs): Promise<void> {
  const ctx = await getCallerContext();
  if (!ctx) throw new Error('Not signed in.');

  const clean: NotificationPrefs = {
    emailEnabled: Boolean(prefs.emailEnabled),
    mutedTypes: (prefs.mutedTypes ?? []).filter((t): t is NotificationType => KNOWN_TYPES.includes(t)),
  };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('profiles')
    .update({ notification_prefs: { email_enabled: clean.emailEnabled, muted_types: clean.mutedTypes } })
    .eq('id', ctx.userId);
  if (error) throw new Error(error.message);
}
