'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { PlatformBadge, type PlatformId } from '@/app/_landing/platform-icons';
import type { DemoTenantInput } from '@/services/demo/schema';
import type { DemoOrderCard } from '@/app/api/demo/chat/route';

/**
 * The 3-skin public demo chat (docs: "try it for your business" plan, Phase B).
 * WhatsApp / IG DM / Messenger are visual skins over ONE shared conversation —
 * switching tabs never resets the thread. All AI turns go through the stateless
 * /api/demo/chat route; nothing here ever sees an API key.
 */

type Skin = 'whatsapp' | 'instagram' | 'messenger';
type DisplayTurn = { role: 'user' | 'assistant' | 'note'; content: string };

const SKIN_META: Record<
  Skin,
  { label: string; headerBg: string; chatBg: string; userBubble: string; assistantBubble: string }
> = {
  whatsapp: {
    label: 'WhatsApp',
    headerBg: 'bg-[#075E54] text-white',
    chatBg: 'bg-[#e5ddd5] dark:bg-[#0b141a]',
    userBubble: 'bg-[#dcf8c6] text-black dark:bg-[#005c4b] dark:text-white',
    assistantBubble: 'bg-white text-black dark:bg-[#202c33] dark:text-white',
  },
  instagram: {
    label: 'Instagram DM',
    headerBg: 'bg-gradient-to-r from-[#833ab4] via-[#fd1d1d] to-[#fcb045] text-white',
    chatBg: 'bg-white dark:bg-black',
    userBubble: 'bg-gradient-to-r from-[#833ab4] to-[#fd1d1d] text-white',
    assistantBubble: 'bg-muted text-foreground',
  },
  messenger: {
    label: 'Messenger',
    headerBg: 'bg-[#0084FF] text-white',
    chatBg: 'bg-white dark:bg-[#0a0a0a]',
    userBubble: 'bg-[#0084FF] text-white',
    assistantBubble: 'bg-muted text-foreground',
  },
};

const SKIN_PLATFORM: Record<Skin, PlatformId> = {
  whatsapp: 'whatsapp',
  instagram: 'instagram',
  messenger: 'messenger',
};

export function DemoChat({ demoTenant, businessName }: { demoTenant: DemoTenantInput; businessName: string }) {
  const [skin, setSkin] = useState<Skin>('whatsapp');
  const [turns, setTurns] = useState<DisplayTurn[]>([
    { role: 'assistant', content: `Hi! I'm the AI assistant for ${businessName}. What can I help you with today?` },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [orderCard, setOrderCard] = useState<DemoOrderCard | null>(null);
  const [humanTakeover, setHumanTakeover] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const meta = SKIN_META[skin];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    const historyForRequest = turns
      .filter((t): t is { role: 'user' | 'assistant'; content: string } => t.role !== 'note')
      .slice(-20);
    setTurns((t) => [...t, { role: 'user', content: text }]);

    if (humanTakeover) {
      setTurns((t) => [
        ...t,
        { role: 'note', content: 'Human takeover is on. A team member would reply here instead of the AI.' },
      ]);
      return;
    }

    setSending(true);
    try {
      const res = await fetch('/api/demo/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demoTenant, history: historyForRequest, text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTurns((t) => [...t, { role: 'assistant', content: data.error || 'Something went wrong. Try again.' }]);
        return;
      }
      setTurns((t) => [...t, { role: 'assistant', content: data.reply }]);
      if (data.orderCard) setOrderCard(data.orderCard);
    } catch {
      setTurns((t) => [...t, { role: 'assistant', content: "Couldn't reach the demo assistant. Try again." }]);
    } finally {
      setSending(false);
    }
  }

  function decideOrder(next: 'confirmed' | 'rejected') {
    setOrderCard((card) => (card ? { ...card, status: next === 'rejected' ? card.status : 'confirmed' } : card));
    setTurns((t) => [
      ...t,
      {
        role: 'note',
        content:
          next === 'confirmed'
            ? '✅ Order approved from the command center. The customer would now get a confirmation message.'
            : '❌ Order rejected from the command center. The customer would be notified and asked to revise it.',
      },
    ]);
    if (next === 'rejected') setOrderCard(null);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card className="overflow-hidden py-0">
        <div className={`flex items-center justify-between gap-2 px-4 py-3 ${meta.headerBg}`}>
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <PlatformBadge platform={SKIN_PLATFORM[skin]} className="shrink-0 shadow-none ring-2 ring-white/25" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{businessName || 'Your business'}</p>
              <p className="text-xs opacity-80">{sending ? 'typing…' : 'online'}</p>
            </div>
          </div>
          <Tabs value={skin} onValueChange={(v) => setSkin(v as Skin)} className="shrink-0">
            <TabsList>
              {(Object.keys(SKIN_META) as Skin[]).map((s) => (
                <TabsTrigger key={s} value={s} title={SKIN_META[s].label}>
                  <PlatformBadge platform={SKIN_PLATFORM[s]} className="size-5 rounded-md shadow-none" iconClassName="size-3" />
                  <span className="sr-only">{SKIN_META[s].label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <div ref={scrollRef} className={`h-[420px] space-y-2 overflow-y-auto px-4 py-4 ${meta.chatBg}`}>
          {turns.map((t, i) =>
            t.role === 'note' ? (
              <div
                key={i}
                className="animate-in fade-in slide-in-from-bottom-1 mx-auto max-w-[85%] rounded-md bg-black/10 px-3 py-1.5 text-center text-xs text-foreground/70 duration-300 dark:bg-white/10"
              >
                {t.content}
              </div>
            ) : (
              <div key={i} className={`animate-in fade-in slide-in-from-bottom-1 flex duration-300 ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[75%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm shadow-sm ${
                    t.role === 'user' ? meta.userBubble : meta.assistantBubble
                  }`}
                >
                  {t.content}
                </div>
              </div>
            ),
          )}
          {sending && (
            <div className="animate-in fade-in flex justify-start duration-300">
              <div className={`flex items-center gap-1 rounded-lg px-3 py-2.5 shadow-sm ${meta.assistantBubble}`}>
                <span className="size-1.5 animate-bounce rounded-full bg-current opacity-50 [animation-delay:-0.3s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-current opacity-50 [animation-delay:-0.15s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-current opacity-50" />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-3 py-3">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Type a message like a customer would…"
            disabled={sending}
          />
          <Button onClick={sendMessage} disabled={sending || !input.trim()}>
            Send
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Command center peek</CardTitle>
          <CardDescription>A glimpse of what your team sees while the AI is talking to customers.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-input px-3 py-2">
            <div>
              <p className="text-sm font-medium">Human takeover</p>
              <p className="text-xs text-muted-foreground">Step in and reply yourself, anytime.</p>
            </div>
            <Switch checked={humanTakeover} onCheckedChange={setHumanTakeover} />
          </div>

          {orderCard ? (
            <div className="space-y-2 rounded-lg border border-input p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Simulated order</p>
                <Badge variant={orderCard.status === 'confirmed' ? 'default' : 'secondary'}>
                  {orderCard.status === 'confirmed' ? 'Confirmed' : 'Pending approval'}
                </Badge>
              </div>
              <ul className="space-y-1 text-sm">
                {orderCard.items.map((item, i) => (
                  <li key={i}>
                    {item.qty}× {item.name}
                    {item.customization ? <span className="text-muted-foreground"> — {item.customization}</span> : null}
                  </li>
                ))}
              </ul>
              <div className="space-y-0.5 text-xs text-muted-foreground">
                {orderCard.customerName && <p>{orderCard.customerName}</p>}
                {orderCard.customerPhone && <p>{orderCard.customerPhone}</p>}
                {orderCard.customerAddress && <p>{orderCard.customerAddress}</p>}
              </div>
              {orderCard.status === 'pending' && (
                <div className="flex gap-2 pt-1">
                  <Button size="sm" onClick={() => decideOrder('confirmed')}>
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => decideOrder('rejected')}>
                    Reject
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-input p-3 text-xs text-muted-foreground">
              Ask the AI to place an order in the chat and it&apos;ll show up here, just like it would for your team.
            </p>
          )}

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Same conversation, every skin</Label>
            <p className="text-xs text-muted-foreground">
              Switching tabs only changes how the chat looks. It&apos;s the same AI, the same thread, across
              WhatsApp, Instagram DMs, and Messenger.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
