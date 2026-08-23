'use client';

import { useActionState, useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, CheckCircle2, CircleDashed, ShieldCheck } from 'lucide-react';
import { PlatformBadge, type PlatformId } from '@/app/_landing/platform-icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusPill } from '@/components/status-pill';
import { cn } from '@/lib/utils';
import {
  disconnectChannelAction,
  enableWidgetAction,
  requestPlatformSetupAction,
  rotateWidgetKeyAction,
} from '../actions';
import {
  initialEnableWidgetState,
  initialRequestPlatformSetupState,
  type PlatformChannel,
} from '../action-state';

const CHANNEL_BADGE: Record<PlatformChannel, PlatformId> = {
  whatsapp: 'whatsapp',
  facebook: 'messenger',
  instagram: 'instagram',
  web: 'web',
};

const ETA_BUSINESS_DAYS = 5;

function addBusinessDays(from: Date, days: number): Date {
  const result = new Date(from);
  let remaining = days;
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return result;
}

const SETUP_STEPS = ['Requested', "We're connecting", 'Live'] as const;

function SetupTracker({ requestedAt }: { requestedAt: string }) {
  const eta = formatEtaDate(addBusinessDays(new Date(requestedAt), ETA_BUSINESS_DAYS));
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg bg-muted/40 px-3 py-2.5">
      <div className="flex items-center">
        {SETUP_STEPS.map((label, i) => {
          const isDone = i === 0;
          const isCurrent = i === 1;
          return (
            <div key={label} className={cn('flex items-center', i < SETUP_STEPS.length - 1 && 'flex-1')}>
              <div className="flex flex-col items-center gap-1">
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-full',
                    isDone && 'bg-primary text-primary-foreground',
                    isCurrent && 'bg-primary/15 ring-2 ring-primary',
                    !isDone && !isCurrent && 'border border-input bg-background',
                  )}
                >
                  {isDone && <Check className="size-2.5" />}
                </span>
                <span
                  className={cn(
                    'text-center text-[10px] leading-tight text-nowrap',
                    isDone || isCurrent ? 'font-medium text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {label}
                </span>
              </div>
              {i < SETUP_STEPS.length - 1 && (
                <span aria-hidden className={cn('mx-1 h-px flex-1 -translate-y-2.5', i === 0 ? 'bg-primary' : 'bg-input')} />
              )}
            </div>
          );
        })}
      </div>
      <p className="text-center text-[11px] text-muted-foreground">
        Requested {formatEtaDate(new Date(requestedAt))} — we&apos;ll have this live by{' '}
        <span className="font-medium text-foreground">{eta}</span>.
      </p>
    </div>
  );
}

function formatEtaDate(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short' });
}

interface ChannelInfo {
  value: PlatformChannel;
  label: string;
  hint: string;
  needFromYou: string;
}

const CHANNELS: ChannelInfo[] = [
  {
    value: 'whatsapp',
    label: 'WhatsApp',
    hint: 'Customers message your WhatsApp Business number.',
    needFromYou: 'Your WhatsApp Business phone number.',
  },
  {
    value: 'facebook',
    label: 'Messenger',
    hint: 'Customers message your Facebook Page.',
    needFromYou: 'Your Facebook Page name/link, and Partner access on Meta Business Manager.',
  },
  {
    value: 'instagram',
    label: 'Instagram',
    hint: 'Customers DM your Instagram account.',
    needFromYou: 'Your Instagram professional account login — no Facebook Page needed.',
  },
  {
    value: 'web',
    label: 'Website chat',
    hint: 'A chat widget on your own website.',
    needFromYou: 'Your website domain.',
  },
];

function openConnectPopup(url: string, name: string, onBlocked: () => void): void {
  const popup = window.open(url, name, 'width=600,height=700');
  if (!popup) {
    onBlocked();
    return;
  }
  const poll = window.setInterval(() => {
    if (popup.closed) window.clearInterval(poll);
  }, 500);
}

function MetaConnectButton({ tenantId, reconnect }: { tenantId: string; reconnect?: boolean }) {
  const router = useRouter();
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== 'meta-connected') return;
      setIsConnecting(false);
      if (event.data.ok) {
        toast.success(event.data.note ?? 'Facebook & Instagram connected.');
        router.refresh();
      } else {
        toast.error(event.data.error ?? 'Connection failed.');
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [router]);

  function connect() {
    setIsConnecting(true);
    openConnectPopup(`/api/meta/connect?tenantId=${encodeURIComponent(tenantId)}`, 'meta-connect', () => {
      setIsConnecting(false);
      toast.error('Please allow popups to connect Facebook & Instagram.');
    });
    window.setTimeout(() => setIsConnecting(false), 120_000);
  }

  return (
    <Button type="button" size="sm" variant="outline" onClick={connect} disabled={isConnecting}>
      {isConnecting ? 'Connecting…' : reconnect ? 'Reconnect' : 'Connect with Facebook'}
    </Button>
  );
}

function WhatsAppConnectButton({ tenantId, reconnect }: { tenantId: string; reconnect?: boolean }) {
  const router = useRouter();
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== 'whatsapp-connected') return;
      setIsConnecting(false);
      if (event.data.ok) {
        toast.success('WhatsApp connected.');
        router.refresh();
      } else {
        toast.error(event.data.error ?? 'Connection failed.');
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [router]);

  function connect() {
    setIsConnecting(true);
    openConnectPopup(`/api/meta/whatsapp?tenantId=${encodeURIComponent(tenantId)}`, 'whatsapp-connect', () => {
      setIsConnecting(false);
      toast.error('Please allow popups to connect WhatsApp.');
    });
    window.setTimeout(() => setIsConnecting(false), 120_000);
  }

  return (
    <Button type="button" size="sm" variant="outline" onClick={connect} disabled={isConnecting}>
      {isConnecting ? 'Connecting…' : reconnect ? 'Reconnect' : 'Connect WhatsApp'}
    </Button>
  );
}

/** Standalone Instagram (Meta's Instagram Business Login) — no Facebook Page required, unlike MetaConnectButton above. */
function InstagramConnectButton({ tenantId, reconnect }: { tenantId: string; reconnect?: boolean }) {
  const router = useRouter();
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== 'instagram-connected') return;
      setIsConnecting(false);
      if (event.data.ok) {
        toast.success(event.data.note ?? 'Instagram connected.');
        router.refresh();
      } else {
        toast.error(event.data.error ?? 'Connection failed.');
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [router]);

  function connect() {
    setIsConnecting(true);
    openConnectPopup(`/api/meta/instagram?tenantId=${encodeURIComponent(tenantId)}`, 'instagram-connect', () => {
      setIsConnecting(false);
      toast.error('Please allow popups to connect Instagram.');
    });
    window.setTimeout(() => setIsConnecting(false), 120_000);
  }

  return (
    <Button type="button" size="sm" variant="outline" onClick={connect} disabled={isConnecting}>
      {isConnecting ? 'Connecting…' : reconnect ? 'Reconnect' : 'Connect with Instagram'}
    </Button>
  );
}

/**
 * Two-step (click-to-confirm, no modal) disconnect for a connected channel.
 * Reused across Facebook/Instagram/WhatsApp/Website chat rows below — the
 * `extraWarning` prop covers the one cross-channel case (Facebook taking a
 * bundled Instagram connection down with it).
 */
function DisconnectButton({
  tenantId,
  channel,
  label,
  extraWarning,
}: {
  tenantId: string;
  channel: PlatformChannel;
  label: string;
  extraWarning?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  function disconnect() {
    startTransition(async () => {
      const result = await disconnectChannelAction(tenantId, channel);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`${label} disconnected.`);
        setConfirming(false);
        router.refresh();
      }
    });
  }

  if (confirming) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="destructive" onClick={disconnect} disabled={isPending}>
            {isPending ? 'Disconnecting…' : 'Confirm disconnect'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setConfirming(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
        </div>
        {extraWarning && <p className="max-w-[220px] text-right text-[11px] text-destructive">{extraWarning}</p>}
      </div>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      onClick={() => setConfirming(true)}
    >
      Disconnect
    </Button>
  );
}

function widgetSnippet(appUrl: string, key: string): string {
  return `<script src="${appUrl.replace(/\/$/, '')}/embed/widget.js" data-clerknest-key="${key}" defer></script>`;
}

function WidgetSetup({
  tenantId,
  appUrl,
  widgetPublicKey,
  widgetAllowedOrigins,
}: {
  tenantId: string;
  appUrl: string;
  widgetPublicKey: string | null;
  widgetAllowedOrigins: string[];
}) {
  const router = useRouter();
  const boundAction = enableWidgetAction.bind(null, tenantId);
  const [state, formAction, isPending] = useActionState(boundAction, initialEnableWidgetState);
  const [rotating, startRotate] = useTransition();
  const defaultDomain = widgetAllowedOrigins[0]?.replace(/^https?:\/\//, '') ?? '';

  useEffect(() => {
    if (state.success) {
      toast.success('Website chat is ready. Copy the snippet onto your site.');
      router.refresh();
    }
  }, [state, router]);

  function copySnippet() {
    if (!widgetPublicKey) return;
    void navigator.clipboard.writeText(widgetSnippet(appUrl, widgetPublicKey));
    toast.success('Snippet copied.');
  }

  return (
    <div className="space-y-3 rounded-lg border border-input px-3 py-2.5">
      <div>
        <p className="text-sm font-medium">Website chat</p>
        <p className="text-xs text-muted-foreground">
          Enter your domain, turn the widget on, then paste one line of code on your site.
        </p>
      </div>
      <form action={formAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="widget-domain">Website domain</Label>
          <Input
            id="widget-domain"
            name="domain"
            required
            defaultValue={defaultDomain}
            placeholder="acme.com"
          />
        </div>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? 'Saving…' : widgetPublicKey ? 'Update domain' : 'Enable widget'}
        </Button>
      </form>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {widgetPublicKey && (
        <div className="space-y-2">
          <Label htmlFor="widget-snippet">Embed snippet</Label>
          <textarea
            id="widget-snippet"
            readOnly
            rows={3}
            className="w-full rounded-md border border-input bg-muted/40 p-2 font-mono text-xs"
            value={widgetSnippet(appUrl, widgetPublicKey)}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={copySnippet}>
              Copy snippet
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={rotating}
              onClick={() => {
                startRotate(async () => {
                  const result = await rotateWidgetKeyAction(tenantId);
                  if (result.error) toast.error(result.error);
                  else {
                    toast.success('New widget key generated. Update the snippet on your site.');
                    router.refresh();
                  }
                });
              }}
            >
              {rotating ? 'Rotating…' : 'Rotate key'}
            </Button>
            <DisconnectButton tenantId={tenantId} channel="web" label="Website chat" />
          </div>
        </div>
      )}
    </div>
  );
}

function isPendingNameStatus(status: string | null): boolean {
  if (!status) return false;
  const upper = status.toUpperCase();
  return upper.includes('PENDING') && !upper.includes('APPROVED');
}

export function ChannelSetup({
  tenantId,
  connections,
  requestedPlatforms,
  platformSetupNotes,
  platformSetupRequestedAt,
  widgetPublicKey,
  widgetAllowedOrigins,
  appUrl,
  whatsappNameStatus,
  instagramBundledWithFacebook,
}: {
  tenantId: string;
  connections: Record<PlatformChannel, boolean>;
  requestedPlatforms: string[];
  platformSetupNotes: string | null;
  platformSetupRequestedAt: string | null;
  widgetPublicKey: string | null;
  widgetAllowedOrigins: string[];
  appUrl: string;
  whatsappNameStatus: string | null;
  /** True when Instagram is only reachable via the Facebook Page token (no standalone token) — see instagramTokenSecretId's docstring in types/domain.ts. Disconnecting Facebook takes this Instagram connection down too. */
  instagramBundledWithFacebook: boolean;
}) {
  const boundAction = requestPlatformSetupAction.bind(null, tenantId);
  const [state, formAction, isPending] = useActionState(boundAction, initialRequestPlatformSetupState);
  const [selected, setSelected] = useState<PlatformChannel[]>([]);
  const [notes, setNotes] = useState('');

  const pendingSet = useMemo(
    () => new Set(requestedPlatforms.filter((p) => !connections[p as PlatformChannel])),
    [requestedPlatforms, connections],
  );

  // Instagram has its own standalone Connect row below now, so this one only
  // tracks Facebook/Messenger itself — Instagram riding along on that OAuth
  // grant is a bonus, not something that gates this button's wording.
  const messengerNeedsConnect = !connections.facebook;

  useEffect(() => {
    if (state.success) {
      toast.success("Request sent. We'll be in touch.");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing the form is a reaction to a successful submit, not a render-time state sync
      setSelected([]);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      setNotes('');
    }
  }, [state]);

  function toggle(value: PlatformChannel) {
    setSelected((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Channels</CardTitle>
        <CardDescription>Where your AI assistant talks to customers.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3.5">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              You never need to share passwords or API keys with us.
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Messenger, Instagram, and WhatsApp connect through Meta&apos;s own login. Website chat is a
              snippet you paste yourself.{' '}
              <Link href="/security" className="text-primary underline underline-offset-2">
                See exactly what we can and can&apos;t see
              </Link>
              .
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {CHANNELS.map((c) => {
            const isConnected = connections[c.value];
            const isPendingSetup = !isConnected && pendingSet.has(c.value);
            return (
              <div key={c.value} className="flex min-w-0 items-start gap-2.5 overflow-hidden rounded-lg border border-input px-3 py-2.5">
                {isConnected ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                ) : isPendingSetup ? (
                  <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-pending" />
                ) : (
                  <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                    <PlatformBadge
                      platform={CHANNEL_BADGE[c.value]}
                      className="size-5 shrink-0 rounded-md shadow-none"
                      iconClassName="size-3"
                    />
                    <span className="text-sm font-medium">{c.label}</span>
                    {isConnected && <StatusPill tone="success">Connected</StatusPill>}
                    {isPendingSetup && <StatusPill tone="pending">Setting up</StatusPill>}
                    {c.value === 'whatsapp' && isConnected && isPendingNameStatus(whatsappNameStatus) && (
                      <StatusPill tone="pending">Name pending</StatusPill>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{c.hint}</p>
                  {c.value === 'whatsapp' && isConnected && isPendingNameStatus(whatsappNameStatus) && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Meta is still reviewing the WhatsApp display name. Replies in an open chat still work.
                    </p>
                  )}
                  {isPendingSetup && platformSetupRequestedAt && (
                    <SetupTracker requestedAt={platformSetupRequestedAt} />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-input px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {messengerNeedsConnect ? 'Connect Facebook & Instagram' : 'Facebook & Instagram'}
            </p>
            <p className="text-xs text-muted-foreground">
              {messengerNeedsConnect
                ? 'One click, via Meta — no Partner request needed.'
                : 'Already connected. Reconnect if messages stop after a password change.'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <MetaConnectButton tenantId={tenantId} reconnect={!messengerNeedsConnect} />
            {connections.facebook && (
              <DisconnectButton
                tenantId={tenantId}
                channel="facebook"
                label="Facebook"
                extraWarning={
                  connections.instagram && instagramBundledWithFacebook
                    ? 'This will also disconnect Instagram (it rides on the same Facebook connection).'
                    : undefined
                }
              />
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-input px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {connections.instagram ? 'Instagram' : 'Connect Instagram directly'}
            </p>
            <p className="text-xs text-muted-foreground">
              {connections.instagram
                ? 'Already connected. Reconnect if messages stop after a password change.'
                : "Only want Instagram, not Messenger? Connect it on its own — no Facebook Page needed."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <InstagramConnectButton tenantId={tenantId} reconnect={connections.instagram} />
            {connections.instagram && (
              <DisconnectButton tenantId={tenantId} channel="instagram" label="Instagram" />
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-input px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-medium">{connections.whatsapp ? 'WhatsApp' : 'Connect WhatsApp'}</p>
            <p className="text-xs text-muted-foreground">
              {connections.whatsapp
                ? 'Already connected. Reconnect if Meta revoked access.'
                : 'Meta window: confirm the business, phone number, and display name.'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <WhatsAppConnectButton tenantId={tenantId} reconnect={connections.whatsapp} />
            {connections.whatsapp && (
              <DisconnectButton tenantId={tenantId} channel="whatsapp" label="WhatsApp" />
            )}
          </div>
        </div>

        <WidgetSetup
          tenantId={tenantId}
          appUrl={appUrl}
          widgetPublicKey={widgetPublicKey}
          widgetAllowedOrigins={widgetAllowedOrigins}
        />

        {!connections.whatsapp && (
          <form action={formAction} className="space-y-3 border-t border-border pt-4">
            <div>
              <p className="text-sm font-medium">Can&apos;t finish WhatsApp yourself?</p>
              <p className="text-xs text-muted-foreground">
                Ask us to set it up the old way. We&apos;ll need your WhatsApp Business number.
                {platformSetupNotes ? ` Last note: "${platformSetupNotes}"` : ''}
              </p>
            </div>

            <label
              className={`flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                selected.includes('whatsapp') ? 'border-primary bg-primary/5' : 'border-input'
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="platforms"
                  value="whatsapp"
                  checked={selected.includes('whatsapp')}
                  onChange={() => toggle('whatsapp')}
                  className="h-3.5 w-3.5"
                />
                <PlatformBadge
                  platform="whatsapp"
                  className="size-5 rounded-md shadow-none"
                  iconClassName="size-3"
                />
                <span className="text-sm font-medium">Ask ClerkNest to set up WhatsApp</span>
              </span>
            </label>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="notes">Anything we should know? (optional)</Label>
              <Textarea
                id="notes"
                name="notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. our WhatsApp number is +92 300 1234567"
              />
            </div>

            {state.error && <p className="text-sm text-destructive">{state.error}</p>}

            <Button type="submit" size="sm" disabled={isPending || selected.length === 0}>
              {isPending ? 'Sending…' : 'Request setup'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
