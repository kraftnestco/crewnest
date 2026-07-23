'use client';

import { useEffect, useReducer } from 'react';
import {
  CheckCheck,
  Sparkles,
  ShoppingBag,
  Wallet,
  PackageX,
  LifeBuoy,
  Radio,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PLATFORMS, PlatformBadge, type PlatformId } from './platform-icons';

/**
 * Hero showcase — an auto-playing "full picture" of the platform, not just a
 * chat mock. Two synced panels: the customer conversation on the left and the
 * owner's live dashboard on the right, reacting in real time. One choreographed
 * loop walks a whole business flow — browse → order → EasyPaisa payment →
 * confirmed, stock auto-decrementing to sold-out along the way — then switches
 * channel (WhatsApp → Instagram) for a human-handoff scene. Fully scripted: no
 * backend, no tokens, no abuse surface. Honours prefers-reduced-motion with a
 * static filled snapshot.
 */

type OrderStatus = 'none' | 'new' | 'awaiting' | 'paid' | 'confirmed';
type AlertKind = 'order' | 'payment' | 'stock' | 'handoff';

interface Msg {
  id: number;
  role: 'customer' | 'ai';
  text: string;
}
interface AlertItem {
  id: number;
  kind: AlertKind;
  text: string;
}
interface DemoState {
  channel: PlatformId;
  messages: Msg[];
  typing: boolean;
  orderStatus: OrderStatus;
  stock: number;
  stockVisible: boolean;
  handoff: boolean;
  alerts: AlertItem[];
}

const PRODUCT = 'Sea Green Kurta';

const START: DemoState = {
  channel: 'whatsapp',
  messages: [{ id: 1, role: 'customer', text: 'Do you have the Sea Green kurta in medium?' }],
  typing: false,
  orderStatus: 'none',
  stock: 2,
  stockVisible: false,
  handoff: false,
  alerts: [],
};

// A representative "everything's happened" frame for reduced-motion users.
const REDUCED: DemoState = {
  channel: 'whatsapp',
  messages: [
    { id: 5, role: 'customer', text: 'EasyPaisa please' },
    { id: 6, role: 'ai', text: 'Sent the EasyPaisa number — tap here once paid ✅' },
    { id: 7, role: 'customer', text: 'Paid ✅' },
    { id: 8, role: 'ai', text: 'Payment received — order confirmed! 🎉 Ships today.' },
  ],
  typing: false,
  orderStatus: 'confirmed',
  stock: 0,
  stockVisible: true,
  handoff: false,
  alerts: [
    { id: 11, kind: 'order', text: 'New order #1042 · Rs. 5,000' },
    { id: 12, kind: 'payment', text: 'Payment received · Rs. 5,000' },
    { id: 13, kind: 'stock', text: 'Sold out: Sea Green (M)' },
  ],
};

// Each frame waits `delay` ms, then folds a patch into the running state. Frame 0
// is the loop's reset/hold: the scheduler lands on it after the last frame,
// holds, then snaps back to START and replays.
const SCRIPT: { delay: number; step: (s: DemoState) => DemoState }[] = [
  { delay: 2800, step: () => START },
  { delay: 1600, step: (s) => ({ ...s, typing: true }) },
  {
    delay: 1300,
    step: (s) => ({
      ...s,
      typing: false,
      stockVisible: true,
      messages: [...s.messages, { id: 2, role: 'ai', text: 'Yes! 2 left in Sea Green (M). Want me to set one aside?' }],
    }),
  },
  { delay: 1700, step: (s) => ({ ...s, messages: [...s.messages, { id: 3, role: 'customer', text: "Perfect — I'll take 2 🙌" }] }) },
  { delay: 900, step: (s) => ({ ...s, typing: true }) },
  {
    delay: 1500,
    step: (s) => ({
      ...s,
      typing: false,
      orderStatus: 'new',
      alerts: [...s.alerts, { id: 11, kind: 'order', text: 'New order #1042 · Rs. 5,000' }],
      messages: [...s.messages, { id: 4, role: 'ai', text: "Done. That's Rs. 5,000 for 2. Pay by COD, bank, or EasyPaisa?" }],
    }),
  },
  { delay: 1800, step: (s) => ({ ...s, messages: [...s.messages, { id: 5, role: 'customer', text: 'EasyPaisa please' }] }) },
  { delay: 900, step: (s) => ({ ...s, typing: true }) },
  {
    delay: 1300,
    step: (s) => ({
      ...s,
      typing: false,
      orderStatus: 'awaiting',
      messages: [...s.messages, { id: 6, role: 'ai', text: 'Sent the EasyPaisa number — tap here once paid ✅' }],
    }),
  },
  { delay: 1900, step: (s) => ({ ...s, messages: [...s.messages, { id: 7, role: 'customer', text: 'Paid ✅' }] }) },
  {
    delay: 900,
    step: (s) => ({
      ...s,
      orderStatus: 'paid',
      stock: 0,
      alerts: [
        ...s.alerts,
        { id: 12, kind: 'payment', text: 'Payment received · Rs. 5,000' },
        { id: 13, kind: 'stock', text: 'Sold out: Sea Green (M)' },
      ],
    }),
  },
  { delay: 1100, step: (s) => ({ ...s, typing: true }) },
  {
    delay: 1300,
    step: (s) => ({
      ...s,
      typing: false,
      orderStatus: 'confirmed',
      messages: [...s.messages, { id: 8, role: 'ai', text: 'Payment received — order confirmed! 🎉 Ships today.' }],
    }),
  },
  {
    delay: 2400,
    step: (s) => ({
      ...s,
      channel: 'instagram',
      typing: false,
      messages: [{ id: 9, role: 'customer', text: 'Hi! My kurta arrived with a small tear 😞 can you help?' }],
    }),
  },
  { delay: 900, step: (s) => ({ ...s, typing: true }) },
  {
    delay: 1500,
    step: (s) => ({
      ...s,
      typing: false,
      handoff: true,
      alerts: [...s.alerts, { id: 14, kind: 'handoff', text: 'Handoff → owner · Instagram' }],
      messages: [...s.messages, { id: 10, role: 'ai', text: "I'm so sorry! Let me bring in the owner to make this right 🙏" }],
    }),
  },
];

const CHANNEL_RAIL: PlatformId[] = ['whatsapp', 'instagram', 'messenger', 'web'];

const STATUS_META: Record<Exclude<OrderStatus, 'none'>, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-sky-500/20' },
  awaiting: { label: 'Awaiting payment', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20' },
  paid: { label: 'Paid', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20' },
  confirmed: { label: 'Confirmed', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/25' },
};

const ALERT_META: Record<AlertKind, { icon: typeof ShoppingBag; cls: string }> = {
  order: { icon: ShoppingBag, cls: 'text-sky-600 dark:text-sky-400' },
  payment: { icon: Wallet, cls: 'text-emerald-600 dark:text-emerald-400' },
  stock: { icon: PackageX, cls: 'text-amber-600 dark:text-amber-400' },
  handoff: { icon: LifeBuoy, cls: 'text-violet-600 dark:text-violet-400' },
};

function reducer(_s: DemoState, step: (s: DemoState) => DemoState): DemoState {
  return step(_s);
}

export function HeroVisual() {
  const [state, dispatch] = useReducer(reducer, START);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      dispatch(() => REDUCED);
      return;
    }
    let i = 1;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      dispatch(SCRIPT[i].step);
      i = (i + 1) % SCRIPT.length;
      timer = setTimeout(tick, SCRIPT[i].delay);
    };
    timer = setTimeout(tick, SCRIPT[1].delay);
    return () => clearTimeout(timer);
  }, []);

  const visible = state.messages.slice(-4);
  const feed = state.alerts.slice(-3);
  const hasActivity = state.orderStatus !== 'none' || state.stockVisible || state.alerts.length > 0;

  return (
    <div
      className="relative isolate mx-auto w-full max-w-xl"
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse') return;
        const rect = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty('--mx', `${((e.clientX - rect.left) / rect.width) * 100}%`);
        e.currentTarget.style.setProperty('--my', `${((e.clientY - rect.top) / rect.height) * 100}%`);
      }}
    >
      <div className="pointer-events-none absolute -inset-20 -z-10 opacity-80 [background:radial-gradient(420px_circle_at_var(--mx,50%)_var(--my,25%),color-mix(in_oklch,var(--foreground)_8%,transparent),transparent_70%)]" />

      <div
        className="animate-float pointer-events-none absolute -top-8 left-1/2 z-10 -translate-x-1/2"
        style={{ '--float-rotate': '0deg' } as React.CSSProperties}
      >
        <div className="flex items-center gap-1 rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background shadow-lg">
          <Sparkles className="size-3.5" />
          Runs your business, not just the chat
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.25fr_1fr]">
        {/* ── Customer chat ─────────────────────────────────────────── */}
        <div className="flex flex-col rounded-2xl bg-card p-3.5 shadow-xl ring-1 ring-foreground/10">
          <div className="flex items-center justify-between gap-2 border-b border-border pb-2.5">
            <div className="flex items-center gap-2">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              <span className="text-xs font-medium text-muted-foreground">Live · AI Employee</span>
            </div>
            {state.handoff ? (
              <span className="flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-600 dark:text-violet-400">
                <LifeBuoy className="size-3" />
                Owner joining
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <PlatformBadge platform={state.channel} className="size-5 rounded-md" iconClassName="size-3" />
                {PLATFORMS[state.channel].label}
              </span>
            )}
          </div>

          <div className="flex min-h-[188px] flex-col justify-end gap-2 pt-3">
            {visible.map((m) =>
              m.role === 'customer' ? (
                <div
                  key={m.id}
                  className="max-w-[88%] self-start rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm text-foreground"
                >
                  {m.text}
                </div>
              ) : (
                <div
                  key={m.id}
                  className="max-w-[88%] self-end rounded-2xl rounded-br-sm bg-foreground px-3 py-2 text-sm text-background"
                >
                  {m.text}
                </div>
              ),
            )}

            {state.typing && (
              <div className="flex items-center gap-1 self-end rounded-2xl rounded-br-sm bg-foreground/10 px-3 py-2.5">
                <span className="size-1.5 animate-bounce rounded-full bg-foreground/50 [animation-delay:-0.3s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-foreground/50 [animation-delay:-0.15s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-foreground/50" />
              </div>
            )}
          </div>

          <div className="mt-2.5 flex items-center gap-1 border-t border-border pt-2.5 text-[11px] text-muted-foreground">
            <CheckCheck className="size-3.5 text-emerald-500" />
            Synced to your dashboard
          </div>
        </div>

        {/* ── Live dashboard ────────────────────────────────────────── */}
        <div className="flex flex-col gap-2.5 rounded-2xl bg-card p-3.5 shadow-xl ring-1 ring-foreground/10">
          <div className="flex items-center justify-between border-b border-border pb-2.5">
            <span className="text-xs font-semibold text-foreground">Your dashboard</span>
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Radio className="size-3 text-emerald-500" />
              Live
            </span>
          </div>

          {/* Multi-channel: one inbox, every channel */}
          <div>
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              One inbox · every channel
            </div>
            <div className="flex items-center gap-1.5">
              {CHANNEL_RAIL.map((id) => (
                <PlatformBadge
                  key={id}
                  platform={id}
                  className={cn(
                    'size-6 rounded-md transition-all duration-300',
                    state.channel === id ? 'scale-110 ring-2 ring-foreground/25' : 'scale-90 opacity-40',
                  )}
                  iconClassName="size-3"
                />
              ))}
            </div>
          </div>

          {/* Order card */}
          {state.orderStatus !== 'none' && (
            <div className="rounded-xl border border-border bg-background/60 p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">Order #1042</span>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
                    STATUS_META[state.orderStatus].cls,
                  )}
                >
                  {STATUS_META[state.orderStatus].label}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="truncate text-xs text-foreground">2 × {PRODUCT}</span>
                <span className="shrink-0 text-xs font-semibold text-foreground">Rs. 5,000</span>
              </div>
            </div>
          )}

          {/* Inventory row */}
          {state.stockVisible && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background/60 px-2.5 py-2">
              <span className="truncate text-xs text-foreground">
                {PRODUCT} · <span className="text-muted-foreground">M</span>
              </span>
              <span
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
                  state.stock === 0
                    ? 'bg-red-500/10 text-red-600 ring-red-500/20 dark:text-red-400'
                    : 'bg-amber-500/10 text-amber-600 ring-amber-500/20 dark:text-amber-400',
                )}
              >
                {state.stock === 0 ? 'Out of stock' : `${state.stock} left`}
              </span>
            </div>
          )}

          {/* Alerts feed */}
          {hasActivity ? (
            <div className="flex flex-col gap-1.5">
              {feed.map((a) => {
                const Icon = ALERT_META[a.kind].icon;
                return (
                  <div key={a.id} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Icon className={cn('size-3.5 shrink-0', ALERT_META[a.kind].cls)} />
                    <span className="truncate">{a.text}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground">Watching your channels…</div>
          )}
        </div>
      </div>
    </div>
  );
}
