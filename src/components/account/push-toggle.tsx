'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { savePushSubscriptionAction, deletePushSubscriptionAction } from '@/lib/push/actions';

/**
 * Push opt-in (docs/21-WEB-PUSH-NOTIFICATIONS.md §2.3).
 *
 * THREE states, not two — because on iOS `PushManager` simply does not exist in
 * a normal Safari tab: push works only after the user manually does Share → Add
 * to Home Screen (iOS 16.4+), and there is no programmatic prompt for that. A
 * bare toggle would silently do nothing for a large share of a mobile-first,
 * owner-operated user base, so the "install first" case gets real instructions
 * instead of a dead switch.
 *
 * Detection is capability-based (+ a display-mode check for the iOS-installed
 * case), never user-agent sniffing.
 */

type SupportState =
  | 'loading'
  | 'supported'
  /** Capabilities are missing AND we're in a browser that would have them once installed to the home screen. */
  | 'needs-install'
  | 'unsupported';

/**
 * Base64url → bytes, the format `applicationServerKey` requires. Backed by an
 * explicit ArrayBuffer (not the default `ArrayBufferLike`) so it satisfies
 * BufferSource under TS's stricter typed-array generics.
 */
function urlBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalized);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Browser push capability — external, synchronous environment state, so it's read via useSyncExternalStore rather than synced into state by an effect. */
const subscribeNever = () => () => {};

function detectSupport(vapidPublicKey: string | null): SupportState {
  if (!vapidPublicKey) return 'unsupported';
  if ('serviceWorker' in navigator && 'PushManager' in window) return 'supported';
  // iOS gains those capabilities only once installed to the Home Screen. Not
  // standalone ⇒ we're in a plain tab, where installing would genuinely help.
  // Already standalone and STILL missing them ⇒ the browser can't do push.
  return window.matchMedia('(display-mode: standalone)').matches ? 'unsupported' : 'needs-install';
}

export function PushToggle({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const support = useSyncExternalStore<SupportState>(
    subscribeNever,
    () => detectSupport(vapidPublicKey),
    // Server render can't know the browser's capabilities; 'loading' renders
    // nothing, so SSR and first client paint agree and there's no hydration flash.
    () => 'loading',
  );
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (support !== 'supported') return;
    // Reflect whatever this browser is actually subscribed to, so the toggle
    // isn't lying after a reload or on a second device. Async by nature — this
    // is a real external-system read, not state-syncing.
    let cancelled = false;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (!cancelled) setEnabled(sub !== null);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [support]);

  const enable = useCallback(async () => {
    if (!vapidPublicKey) return;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      // Denied is sticky in most browsers — say so rather than letting them
      // tap a toggle that can never work until they change site settings.
      toast.error(
        permission === 'denied'
          ? 'Notifications are blocked for this site. Allow them in your browser settings, then try again.'
          : 'Notification permission was not granted.',
      );
      return;
    }

    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBytes(vapidPublicKey),
    });

    const json = subscription.toJSON();
    const result = await savePushSubscriptionAction(
      { endpoint: subscription.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      navigator.userAgent,
    );

    if (!result.success) {
      // Don't leave the browser subscribed to a push we can't send: roll back
      // so the toggle's state and reality agree.
      await subscription.unsubscribe().catch(() => {});
      toast.error(result.error ?? "Couldn't turn on notifications.");
      return;
    }

    setEnabled(true);
    toast.success('Notifications on for this device.');
  }, [vapidPublicKey]);

  const disable = useCallback(async () => {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      setEnabled(false);
      return;
    }

    // Two-sided (§2.4): drop it browser-side AND server-side. If either half
    // fails the other still proceeds — a stale row is pruned on the next send,
    // and a stale browser subscription simply stops receiving.
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe().catch(() => {});
    const result = await deletePushSubscriptionAction(endpoint);
    if (!result.success) {
      toast.error(result.error ?? "Couldn't turn off notifications.");
      return;
    }

    setEnabled(false);
    toast.success('Notifications off for this device.');
  }, []);

  async function handleToggle(checked: boolean) {
    setBusy(true);
    try {
      if (checked) await enable();
      else await disable();
    } catch {
      toast.error('Something went wrong with notifications on this device.');
    } finally {
      setBusy(false);
    }
  }

  if (support === 'loading') return null;

  return (
    <div className="flex items-start justify-between gap-4 border-t pt-3">
      <div>
        <p className="text-sm font-medium">Push notifications on this device</p>
        {support === 'supported' && (
          <p className="text-xs text-muted-foreground">
            Get an alert when a customer asks for a human or looks at risk. Per-device.
          </p>
        )}
        {support === 'needs-install' && (
          <p className="text-xs text-muted-foreground">
            On iPhone, add CrewNest to your Home Screen first (Share → Add to Home Screen), then turn this on.
          </p>
        )}
        {support === 'unsupported' && (
          <p className="text-xs text-muted-foreground">This browser doesn&apos;t support push notifications.</p>
        )}
      </div>
      {support === 'supported' && (
        <Switch checked={enabled} onCheckedChange={handleToggle} disabled={busy} />
      )}
    </div>
  );
}
