'use server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCallerContext } from '@/lib/auth/context';
import type { NotificationPrefs, NotificationType } from '@/types/domain';

/**
 * Every valid notification type. `satisfies` pins this to the NotificationType
 * union, so adding a type there is a COMPILE error here until it's listed —
 * this list had silently drifted to 5 of 11, which meant muting any of the six
 * newer types (review, order_updated, media_review, system_alert,
 * upgrade_request, low_stock) was quietly discarded by the filter below.
 */
const KNOWN_TYPES = [
  'new_order',
  'handoff',
  'alert_signal',
  'channel_request',
  'payment_proof',
  'upgrade_request',
  'review',
  'order_updated',
  'media_review',
  'system_alert',
  'low_stock',
] as const satisfies readonly NotificationType[];

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
    mutedTypes: (prefs.mutedTypes ?? []).filter((t): t is NotificationType =>
      (KNOWN_TYPES as readonly string[]).includes(t),
    ),
  };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('profiles')
    .update({ notification_prefs: { email_enabled: clean.emailEnabled, muted_types: clean.mutedTypes } })
    .eq('id', ctx.userId);
  if (error) throw new Error(error.message);
}
