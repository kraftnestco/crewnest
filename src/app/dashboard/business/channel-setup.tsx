'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, CheckCircle2, CircleDashed, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusPill } from '@/components/status-pill';
import { cn } from '@/lib/utils';
import { requestPlatformSetupAction } from '../actions';
import { initialRequestPlatformSetupState, type PlatformChannel } from '../action-state';

// docs/27 §5 C1 — "3–5 business days" was a vague range; owners want a date.
// No new backend field for this: we compute it from the existing
// `platform_setup_requested_at` timestamp, skipping weekends.
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

/**
 * The data model only has one timestamp per tenant (`platform_setup_requested_at`)
 * and a boolean per channel (`connections`) — no separate "we've started" flag.
 * So the tracker's middle step is treated as reached the moment a request lands:
 * that's when our team's queue actually picks it up, not a later milestone we'd
 * need a new column to detect (C1 is explicitly no-backend-work).
 */
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
    needFromYou: 'Your Instagram handle, and Partner access on Meta Business Manager.',
  },
  {
    value: 'web',
    label: 'Website chat',
    hint: 'A chat widget on your own website.',
    needFromYou: 'Your website domain.',
  },
];

/**
 * docs/27 §5 C2 — one OAuth grant covers both Messenger and Instagram (a
 * Page's linked IG account comes back in the same callback), so this is a
 * single button rather than one per channel. Opens the initiate route in a
 * popup; the callback route posts the result back via `window.postMessage`
 * and closes itself, which is why this listens on `message` rather than
 * awaiting the `window.open` call directly.
 */
function MetaConnectButton({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== 'meta-connected') return;
      setIsConnecting(false);
      if (event.data.ok) {
        toast.success('Facebook & Instagram connected.');
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
    const popup = window.open(
      `/api/meta/connect?tenantId=${encodeURIComponent(tenantId)}`,
      'meta-connect',
      'width=600,height=700',
    );
    if (!popup) {
      setIsConnecting(false);
      toast.error('Please allow popups to connect Facebook & Instagram.');
      return;
    }
    // No message ever arrives if the owner just closes the popup without
    // finishing (declining is the only case Meta itself round-trips to us) —
    // this is what un-sticks the button in that case.
    const poll = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(poll);
        setIsConnecting(false);
      }
    }, 500);
  }

  return (
    <Button type="button" size="sm" variant="outline" onClick={connect} disabled={isConnecting}>
      {isConnecting ? 'Connecting…' : 'Connect with Facebook'}
    </Button>
  );
}

export function ChannelSetup({
  tenantId,
  connections,
  requestedPlatforms,
  platformSetupNotes,
  platformSetupRequestedAt,
}: {
  tenantId: string;
  connections: Record<PlatformChannel, boolean>;
  requestedPlatforms: string[];
  platformSetupNotes: string | null;
  platformSetupRequestedAt: string | null;
}) {
  const boundAction = requestPlatformSetupAction.bind(null, tenantId);
  const [state, formAction, isPending] = useActionState(boundAction, initialRequestPlatformSetupState);
  const [selected, setSelected] = useState<PlatformChannel[]>([]);
  const [notes, setNotes] = useState('');

  const notConnected = useMemo(() => CHANNELS.filter((c) => !connections[c.value]), [connections]);
  // Messenger/Instagram self-serve via OAuth (docs/27 §5 C2) now; only
  // WhatsApp and Website chat still go through the concierge request form.
  const oauthChannels = useMemo(
    () => notConnected.filter((c) => c.value === 'facebook' || c.value === 'instagram'),
    [notConnected],
  );
  const conciergeChannels = useMemo(
    () => notConnected.filter((c) => c.value !== 'facebook' && c.value !== 'instagram'),
    [notConnected],
  );
  const pendingSet = useMemo(() => new Set(requestedPlatforms), [requestedPlatforms]);

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
        {/*
          docs/27 §5 C1 — the strongest selling point in the product was
          buried in a paragraph under the form. Promoted to a bordered
          callout at the top of the screen, with a link to /security that
          explains it in full instead of a one-line aside.
        */}
        <div className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3.5">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              You never need to share passwords or API keys with us.
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              For WhatsApp, you add us as a Partner on your own Meta Business Manager. For Messenger
              and Instagram, you connect directly through Meta&apos;s own login. Both are permissions
              you grant and can revoke — never a password shared with us.{' '}
              <Link href="/security" className="text-primary underline underline-offset-2">
                See exactly what we can and can&apos;t see
              </Link>
              .
            </p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {CHANNELS.map((c) => {
            const isConnected = connections[c.value];
            const isPendingSetup = !isConnected && pendingSet.has(c.value);
            return (
              <div key={c.value} className="flex items-start gap-2.5 rounded-lg border border-input px-3 py-2.5">
                {isConnected ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                ) : isPendingSetup ? (
                  <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-pending" />
                ) : (
                  <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{c.label}</span>
                    {isConnected && <StatusPill tone="success">Connected</StatusPill>}
                    {isPendingSetup && <StatusPill tone="pending">Setting up</StatusPill>}
                  </div>
                  <p className="text-xs text-muted-foreground">{c.hint}</p>
                  {/*
                    Replaces the flat "Requested" badge with a visible
                    three-step tracker so an owner can tell, from the screen
                    alone, what stage they're at and when it completes.
                    `platformSetupRequestedAt` is tenant-wide (one column),
                    not per-channel, so every channel currently in the
                    pending set shares it — accurate as long as a tenant's
                    outstanding requests were all made together, which the
                    single multi-select form below always does.
                  */}
                  {isPendingSetup && platformSetupRequestedAt && (
                    <SetupTracker requestedAt={platformSetupRequestedAt} />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {oauthChannels.length > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-input px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">Connect Facebook &amp; Instagram</p>
              <p className="text-xs text-muted-foreground">One click, via Meta — no Partner request needed.</p>
            </div>
            <MetaConnectButton tenantId={tenantId} />
          </div>
        )}

        {conciergeChannels.length > 0 && (
          <form action={formAction} className="space-y-3 border-t border-border pt-4">
            <div>
              <p className="text-sm font-medium">Request a new channel</p>
              <p className="text-xs text-muted-foreground">
                {conciergeChannels.some((c) => c.value === 'whatsapp')
                  ? "For WhatsApp we'll ask you to add us as a Partner on your Meta Business Manager, then send exact steps once you request setup below."
                  : "Send us what we need and we'll get it connected."}
                {platformSetupNotes ? ` Last note: "${platformSetupNotes}"` : ''}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              {conciergeChannels.map((c) => (
                <label
                  key={c.value}
                  className={`flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                    selected.includes(c.value) ? 'border-primary bg-primary/5' : 'border-input'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="platforms"
                      value={c.value}
                      checked={selected.includes(c.value)}
                      onChange={() => toggle(c.value)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="text-sm font-medium">{c.label}</span>
                  </span>
                  <span className="pl-5 text-xs text-muted-foreground">We&apos;ll need: {c.needFromYou}</span>
                </label>
              ))}
            </div>

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
