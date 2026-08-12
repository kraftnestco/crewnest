import { redirect } from 'next/navigation';
import { getCallerContext } from '@/lib/auth/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import { PageHeader } from '@/components/page-header';
import { AccountForm } from '@/components/account-form';
import type { NotificationPrefs, NotificationType } from '@/types/domain';

export default async function DashboardAccountPage() {
  const ctx = await getCallerContext(); // layout already gated; re-derive (React cache dedupes)
  if (!ctx) redirect('/login');

  const supabase = await createSupabaseServerClient();
  const { data: profileRow } = await supabase
    .from('profiles')
    .select('notification_prefs')
    .eq('id', ctx.userId)
    .single();

  const raw = (profileRow?.notification_prefs ?? {}) as { email_enabled?: boolean; muted_types?: string[] };
  const notificationPrefs: NotificationPrefs = {
    emailEnabled: raw.email_enabled ?? false,
    mutedTypes: (raw.muted_types ?? []) as NotificationType[],
  };

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <PageHeader title="Account" description="Manage your profile, password, and notification preferences." />
      <AccountForm
        profile={{ fullName: ctx.fullName, email: ctx.email, notificationPrefs }}
        scope="dashboard"
        vapidPublicKey={env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null}
      />
    </div>
  );
}
