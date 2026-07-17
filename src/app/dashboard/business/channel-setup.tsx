'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, CircleDashed, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  initialRequestPlatformSetupState,
  requestPlatformSetupAction,
  type PlatformChannel,
} from '../actions';

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
  const pendingSet = useMemo(() => new Set(requestedPlatforms), [requestedPlatforms]);

  useEffect(() => {
    if (state.success) {
      toast.success("Request sent — we'll be in touch.");
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
        <div className="grid gap-2 sm:grid-cols-2">
          {CHANNELS.map((c) => {
            const isConnected = connections[c.value];
            const isPendingSetup = !isConnected && pendingSet.has(c.value);
            return (
              <div key={c.value} className="flex items-start gap-2.5 rounded-lg border border-input px-3 py-2.5">
                {isConnected ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                ) : isPendingSetup ? (
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                ) : (
                  <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{c.label}</span>
                    {isConnected ? (
                      <Badge variant="secondary" className="text-[10px]">
                        Connected
                      </Badge>
                    ) : isPendingSetup ? (
                      <Badge variant="outline" className="text-[10px]">
                        Requested
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">{c.hint}</p>
                </div>
              </div>
            );
          })}
        </div>

        {platformSetupRequestedAt && (
          <p className="text-xs text-muted-foreground">
            Last requested {new Date(platformSetupRequestedAt).toLocaleDateString()}
            {platformSetupNotes ? ` — "${platformSetupNotes}"` : ''}. Our team typically completes setup
            within 3–5 business days and will reach out here if we need anything.
          </p>
        )}

        {notConnected.length > 0 && (
          <form action={formAction} className="space-y-3 border-t border-border pt-4">
            <div>
              <p className="text-sm font-medium">Request a new channel</p>
              <p className="text-xs text-muted-foreground">
                You never need to share passwords or API keys with us. For WhatsApp/Messenger/Instagram
                we&apos;ll ask you to add us as a Partner on your Meta Business Manager — we&apos;ll send
                exact steps once you request setup below.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              {notConnected.map((c) => (
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
