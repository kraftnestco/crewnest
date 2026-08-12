'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { updateFullNameAction, updateNotificationPrefsAction } from '@/lib/account/actions';
import { PushToggle } from '@/components/account/push-toggle';
import type { NotificationPrefs, NotificationType } from '@/types/domain';

const TYPE_LABELS: Record<NotificationType, string> = {
  new_order: 'New orders',
  handoff: 'Human handoff needed',
  alert_signal: 'Flagged conversations',
  channel_request: 'Channel connection requests',
  payment_proof: 'Payment proof submitted',
  upgrade_request: 'Upgrade requests',
  review: 'Low customer ratings',
  order_updated: 'AI-made order edits/cancellations',
  media_review: 'Voice notes, videos & photos needing review',
  system_alert: 'System alerts (e.g. a tenant crossing its daily cost cap)',
  low_stock: 'Low / out-of-stock catalogue items',
};

/** channel_request and system_alert are agency-only (a tenant asking the agency for a new channel, or an infra alert) — never emitted to a tenant's own feed, so they have nothing to mute on the client side (docs/14 §7.3). upgrade_request is mostly agency-only too, except the free-plan monthly cap notice (docs/18 §3, Stage U-cap) also reaches the tenant so they know to upgrade. */
const ADMIN_TYPES: NotificationType[] = [
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
];
const DASHBOARD_TYPES: NotificationType[] = [
  'new_order',
  'handoff',
  'alert_signal',
  'payment_proof',
  'upgrade_request',
  'review',
  'order_updated',
  'media_review',
  'low_stock',
];

export function AccountForm({
  profile,
  scope,
  vapidPublicKey = null,
}: {
  profile: { fullName: string | null; email: string | null; notificationPrefs: NotificationPrefs };
  scope: 'admin' | 'dashboard';
  /** null when push isn't provisioned (docs/21 §2.5 — push is a bolt-on, absent env ⇒ the toggle self-hides). */
  vapidPublicKey?: string | null;
}) {
  const types = scope === 'admin' ? ADMIN_TYPES : DASHBOARD_TYPES;

  const [fullName, setFullName] = useState(profile.fullName ?? '');
  const [isSavingName, startSavingName] = useTransition();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSavingPassword, startSavingPassword] = useTransition();

  const [emailEnabled, setEmailEnabled] = useState(profile.notificationPrefs.emailEnabled ?? false);
  const [mutedTypes, setMutedTypes] = useState<Set<NotificationType>>(new Set(profile.notificationPrefs.mutedTypes ?? []));
  const [isSavingPrefs, startSavingPrefs] = useTransition();

  function handleSaveName() {
    const trimmed = fullName.trim();
    if (!trimmed) {
      toast.error('Full name is required.');
      return;
    }
    startSavingName(async () => {
      try {
        await updateFullNameAction(trimmed);
        toast.success('Name updated.');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update name.');
      }
    });
  }

  function handleChangePassword() {
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match.');
      return;
    }
    startSavingPassword(async () => {
      // Client-side, same as (auth)/login/verify-code-form.tsx: auth.updateUser()
      // acts on the browser client's own session, not an RLS-protected table row.
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        toast.error(error.message);
        return;
      }
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Password updated.');
    });
  }

  function savePrefs(next: { emailEnabled: boolean; mutedTypes: Set<NotificationType> }) {
    startSavingPrefs(async () => {
      try {
        await updateNotificationPrefsAction({ emailEnabled: next.emailEnabled, mutedTypes: [...next.mutedTypes] });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update notification preferences.');
      }
    });
  }

  function handleToggleEmail(checked: boolean) {
    setEmailEnabled(checked);
    savePrefs({ emailEnabled: checked, mutedTypes });
  }

  function handleToggleType(type: NotificationType, enabled: boolean) {
    const next = new Set(mutedTypes);
    if (enabled) next.delete(type);
    else next.add(type);
    setMutedTypes(next);
    savePrefs({ emailEnabled, mutedTypes: next });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-normal text-muted-foreground">Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="account-full-name">Full name</Label>
            <div className="flex gap-2">
              <Input
                id="account-full-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                disabled={isSavingName}
                className="max-w-xs"
              />
              <Button
                size="sm"
                onClick={handleSaveName}
                disabled={isSavingName || fullName.trim() === (profile.fullName ?? '')}
              >
                Save
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="account-email">Email</Label>
            <Input id="account-email" value={profile.email ?? ''} disabled className="max-w-xs" />
            <p className="text-xs text-muted-foreground">Contact us to change your email address.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-normal text-muted-foreground">Change password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="account-new-password">New password</Label>
            <Input
              id="account-new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={isSavingPassword}
              className="max-w-xs"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="account-confirm-password">Confirm new password</Label>
            <Input
              id="account-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={isSavingPassword}
              className="max-w-xs"
            />
          </div>
          <Button size="sm" onClick={handleChangePassword} disabled={isSavingPassword || !newPassword}>
            Update password
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-normal text-muted-foreground">Notification preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex max-w-md items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Email me</p>
              <p className="text-xs text-muted-foreground">Also send these notifications to your email.</p>
            </div>
            <Switch checked={emailEnabled} onCheckedChange={handleToggleEmail} disabled={isSavingPrefs} />
          </div>
          <PushToggle vapidPublicKey={vapidPublicKey} />
          <div className="max-w-md space-y-2.5 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">Notification types</p>
            {types.map((type) => (
              <div key={type} className="flex items-center justify-between gap-4">
                <p className="text-sm">{TYPE_LABELS[type]}</p>
                <Switch
                  checked={!mutedTypes.has(type)}
                  onCheckedChange={(checked) => handleToggleType(type, checked)}
                  disabled={isSavingPrefs}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
