'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import {
  CheckCheck,
  Sparkles,
  ShoppingBag,
  Wallet,
  PackageX,
  LifeBuoy,
  Radio,
  ChevronLeft,
  Phone,
  Video,
  Plus,
  Smile,
  Mic,
  CalendarCheck,
  BellRing,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PLATFORMS, PlatformBadge, type PlatformId } from './platform-icons';

/**
 * Hero showcase — an auto-playing "full picture" of the platform, not just a
 * chat mock. Two synced panels: the customer conversation on the left (skinned
 * to look like the real WhatsApp / Instagram / Messenger app it's arriving on)
 * and the owner's live dashboard on the right, reacting in real time. One
 * choreographed loop walks a whole business flow — browse → order → EasyPaisa
 * payment → confirmed, stock auto-decrementing to sold-out along the way — then
 * switches channel (WhatsApp → Instagram) for a human-handoff scene. Fully
 * scripted: no backend, no tokens, no abuse surface. Honours
 * prefers-reduced-motion with a static filled snapshot.
 */

type OrderStatus = 'none' | 'new' | 'awaiting' | 'paid' | 'confirmed';
type AlertKind = 'order' | 'payment' | 'stock' | 'handoff' | 'booking' | 'reminder';

/** M7 (docs/27 §7 / §9) — the two-door hero switch. `products` is the default door. */
export type HeroVisualVariant = 'products' | 'bookings';

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
const CUSTOMER = 'Ayesha Khan';

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
      handoff: false,
      stockVisible: false,
      orderStatus: 'none',
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

// Second door (M7, docs/27 §9) — a service business taking a booking instead
// of an order. Same shape, same beats (ask → confirm → lock it in → handoff),
// so the two scripts read as siblings rather than a bolted-on variant.
const SERVICE = 'Haircut & Beard Trim';
const CLIENT = 'Bilal Ahmed';

const START_BOOKING: DemoState = {
  channel: 'whatsapp',
  messages: [{ id: 1, role: 'customer', text: 'Hi, do you have a slot for a haircut today?' }],
  typing: false,
  orderStatus: 'none',
  stock: 3,
  stockVisible: false,
  handoff: false,
  alerts: [],
};

const REDUCED_BOOKING: DemoState = {
  channel: 'whatsapp',
  messages: [
    { id: 5, role: 'customer', text: 'Bilal Ahmed' },
    { id: 6, role: 'ai', text: 'Thanks Bilal — holding that slot now, one sec ✅' },
    { id: 7, role: 'ai', text: 'You’re all set — booked for 4:00 PM today. See you then! 🎉' },
  ],
  typing: false,
  orderStatus: 'confirmed',
  stock: 2,
  stockVisible: true,
  handoff: false,
  alerts: [
    { id: 11, kind: 'booking', text: 'New booking request · 4:00 PM' },
    { id: 12, kind: 'reminder', text: 'Reminder scheduled · 3:30 PM' },
  ],
};

const SCRIPT_BOOKING: { delay: number; step: (s: DemoState) => DemoState }[] = [
  { delay: 2800, step: () => START_BOOKING },
  { delay: 1600, step: (s) => ({ ...s, typing: true }) },
  {
    delay: 1300,
    step: (s) => ({
      ...s,
      typing: false,
      stockVisible: true,
      messages: [...s.messages, { id: 2, role: 'ai', text: 'We do! I have 4:00 PM or 5:30 PM open today — which works?' }],
    }),
  },
  { delay: 1700, step: (s) => ({ ...s, messages: [...s.messages, { id: 3, role: 'customer', text: '4:00 PM works great' }] }) },
  { delay: 900, step: (s) => ({ ...s, typing: true }) },
  {
    delay: 1500,
    step: (s) => ({
      ...s,
      typing: false,
      orderStatus: 'new',
      alerts: [...s.alerts, { id: 11, kind: 'booking', text: 'New booking request · 4:00 PM' }],
      messages: [...s.messages, { id: 4, role: 'ai', text: `Booking that in for a ${SERVICE}. Can I get your name?` }],
    }),
  },
  { delay: 1800, step: (s) => ({ ...s, messages: [...s.messages, { id: 5, role: 'customer', text: CLIENT }] }) },
  { delay: 900, step: (s) => ({ ...s, typing: true }) },
  {
    delay: 1300,
    step: (s) => ({
      ...s,
      typing: false,
      orderStatus: 'awaiting',
      messages: [...s.messages, { id: 6, role: 'ai', text: 'Thanks Bilal — holding that slot now, one sec ✅' }],
    }),
  },
  {
    delay: 1300,
    step: (s) => ({
      ...s,
      orderStatus: 'paid',
      stock: 2,
      alerts: [...s.alerts, { id: 12, kind: 'reminder', text: 'Reminder scheduled · 3:30 PM' }],
    }),
  },
  { delay: 1100, step: (s) => ({ ...s, typing: true }) },
  {
    delay: 1300,
    step: (s) => ({
      ...s,
      typing: false,
      orderStatus: 'confirmed',
      messages: [...s.messages, { id: 7, role: 'ai', text: 'You’re all set — booked for 4:00 PM today. See you then! 🎉' }],
    }),
  },
  {
    delay: 2400,
    step: (s) => ({
      ...s,
      channel: 'instagram',
      typing: false,
      handoff: false,
      stockVisible: false,
      orderStatus: 'none',
      messages: [{ id: 8, role: 'customer', text: 'Hey, can I move my 4:00 to tomorrow instead?' }],
    }),
  },
  { delay: 900, step: (s) => ({ ...s, typing: true }) },
  {
    delay: 1500,
    step: (s) => ({
      ...s,
      typing: false,
      handoff: true,
      alerts: [...s.alerts, { id: 13, kind: 'handoff', text: 'Handoff → owner · Instagram' }],
      messages: [...s.messages, { id: 9, role: 'ai', text: 'Of course — let me get the owner to confirm a new time for you 🙏' }],
    }),
  },
];

/** Per-door script + copy — everything the render below needs to stop hardcoding one business. */
const DOORS: Record<
  HeroVisualVariant,
  {
    start: DemoState;
    reduced: DemoState;
    script: typeof SCRIPT;
    customerName: string;
    orderLabel: string;
    orderLine: string;
    orderPrice: string;
    stockName: string;
    stockEmptyLabel: string;
    statusLabels: Record<Exclude<OrderStatus, 'none'>, string>;
  }
> = {
  products: {
    start: START,
    reduced: REDUCED,
    script: SCRIPT,
    customerName: CUSTOMER,
    orderLabel: 'Order #1042',
    orderLine: `2 × ${PRODUCT}`,
    orderPrice: 'Rs. 5,000',
    stockName: `${PRODUCT} · M`,
    stockEmptyLabel: 'Out of stock',
    statusLabels: { new: 'New', awaiting: 'Awaiting payment', paid: 'Paid', confirmed: 'Confirmed' },
  },
  bookings: {
    start: START_BOOKING,
    reduced: REDUCED_BOOKING,
    script: SCRIPT_BOOKING,
    customerName: CLIENT,
    orderLabel: 'Booking #B-204',
    orderLine: SERVICE,
    orderPrice: 'Today · 4:00 PM',
    stockName: 'Today’s open slots',
    stockEmptyLabel: 'Fully booked',
    statusLabels: { new: 'Requested', awaiting: 'Confirming', paid: 'Slot held', confirmed: 'Booked' },
  },
};

const CHANNEL_RAIL: PlatformId[] = ['whatsapp', 'instagram', 'messenger', 'web'];

const STATUS_CLS: Record<Exclude<OrderStatus, 'none'>, string> = {
  new: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-sky-500/20',
  awaiting: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20',
  paid: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20',
  confirmed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/25',
};

const ALERT_META: Record<AlertKind, { icon: typeof ShoppingBag; cls: string }> = {
  order: { icon: ShoppingBag, cls: 'text-sky-600 dark:text-sky-400' },
  payment: { icon: Wallet, cls: 'text-emerald-600 dark:text-emerald-400' },
  stock: { icon: PackageX, cls: 'text-amber-600 dark:text-amber-400' },
  handoff: { icon: LifeBuoy, cls: 'text-violet-600 dark:text-violet-400' },
  booking: { icon: CalendarCheck, cls: 'text-sky-600 dark:text-sky-400' },
  reminder: { icon: BellRing, cls: 'text-violet-600 dark:text-violet-400' },
};

/**
 * Per-channel visual skin so the left panel reads as the real app it arrived
 * on. Exported for reuse by the scroll-pinned channel re-skin section
 * (docs/27 §6.2 item 4, `_landing/channel-reskin.tsx`) — one set of brand
 * colours, not two copies to keep in sync.
 */
export const SKIN: Record<
  PlatformId,
  {
    header: string;
    sub: string;
    area: string;
    doodle: boolean;
    incoming: string;
    outgoing: string;
    tick: string;
    accent: string;
  }
> = {
  whatsapp: {
    header: 'bg-[#008069] text-white dark:bg-[#202c33]',
    sub: 'text-white/75',
    area: 'bg-[#efeae2] dark:bg-[#0b141a]',
    doodle: true,
    incoming: 'bg-white text-[#111b21] rounded-bl-sm dark:bg-[#202c33] dark:text-[#e9edef]',
    outgoing: 'bg-[#d9fdd3] text-[#111b21] rounded-br-sm dark:bg-[#005c4b] dark:text-[#e9edef]',
    tick: 'text-[#53bdeb]',
    accent: 'bg-[#008069] text-white',
  },
  instagram: {
    header: 'bg-white text-[#262626] dark:bg-[#0a0a0a] dark:text-white',
    sub: 'text-[#8e8e8e]',
    area: 'bg-white dark:bg-black',
    doodle: false,
    incoming: 'bg-[#efefef] text-[#262626] rounded-bl-sm dark:bg-[#262626] dark:text-white',
    outgoing: 'bg-gradient-to-br from-[#5b51d8] via-[#d92d84] to-[#f9ce34] text-white rounded-br-sm',
    tick: 'text-white/80',
    accent: 'bg-gradient-to-br from-[#d92d84] to-[#5b51d8] text-white',
  },
  messenger: {
    header: 'bg-white text-[#050505] dark:bg-[#0a0a0a] dark:text-white',
    sub: 'text-[#65676b]',
    area: 'bg-white dark:bg-black',
    doodle: false,
    incoming: 'bg-[#f0f0f0] text-[#050505] rounded-bl-sm dark:bg-[#303030] dark:text-white',
    outgoing: 'bg-gradient-to-br from-[#00b2ff] to-[#006aff] text-white rounded-br-sm',
    tick: 'text-white/80',
    accent: 'bg-[#0084ff] text-white',
  },
  web: {
    header: 'bg-card text-foreground',
    sub: 'text-muted-foreground',
    area: 'bg-muted/30',
    doodle: false,
    incoming: 'bg-muted text-foreground rounded-bl-sm',
    outgoing: 'bg-foreground text-background rounded-br-sm',
    tick: 'text-emerald-400',
    accent: 'bg-foreground text-background',
  },
};

/** Faint tiled doodle backdrop — the signature WhatsApp chat texture. */
function ChatBackdrop() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full text-[#3f3222] opacity-[0.05] dark:text-white dark:opacity-[0.035]"
    >
      <defs>
        <pattern id="cn-wa-doodle" width="90" height="90" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            {/* chat bubble */}
            <rect x="8" y="10" width="18" height="13" rx="4" />
            <path d="M13 23l-1 4 5-4" />
            {/* heart */}
            <path d="M64 27c-7-5-10-9-10-13a4 4 0 0 1 10-2 4 4 0 0 1 10 2c0 4-3 8-10 13z" />
            {/* smiley */}
            <circle cx="20" cy="62" r="8" />
            <circle cx="17" cy="60" r="0.9" />
            <circle cx="23" cy="60" r="0.9" />
            <path d="M16 65a5 4 0 0 0 8 0" />
            {/* camera */}
            <rect x="52" y="58" width="20" height="14" rx="3" />
            <circle cx="62" cy="65" r="4" />
            <path d="M57 58l2-3h6l2 3" />
            {/* music note */}
            <path d="M78 34v10" />
            <circle cx="76" cy="44" r="2" />
            <path d="M78 34l7-1.5v9" />
            <circle cx="83" cy="41.5" r="2" />
            {/* phone */}
            <path d="M34 33c0-1.2 1-2 2-2l1.8 3-1.4 1.4a8 8 0 0 0 4 4l1.4-1.4 3 1.8c0 1-.8 2-2 2-5 0-9.8-4.8-9.8-9.8z" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#cn-wa-doodle)" />
    </svg>
  );
}

const clock = (id: number) => `11:${(20 + id).toString().padStart(2, '0')}`;

/**
 * Reveals `text` a character at a time (docs/27 §6.2 item 1). Keyed by the
 * caller on the message id, so it types out once on first mount and then
 * sits still — a later reducer patch that just re-renders the same message
 * doesn't restart it.
 */
function TypedText({ text }: { text: string }) {
  const [shown, setShown] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? text : '',
  );

  useEffect(() => {
    if (shown === text) return;
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      i += 1;
      setShown(text.slice(0, i));
      if (i < text.length) timer = setTimeout(step, 18 + Math.random() * 22);
    };
    timer = setTimeout(step, 18);
    return () => clearTimeout(timer);
    // Runs once on mount only — see doc comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{shown}</>;
}

function reducer(_s: DemoState, step: (s: DemoState) => DemoState): DemoState {
  return step(_s);
}

export function HeroVisual({ className, variant = 'products' }: { className?: string; variant?: HeroVisualVariant }) {
  const door = DOORS[variant];
  const [state, dispatch] = useReducer(reducer, door.start);
  // Cross-fade between doors (docs/27 §6.2 item 6, 200ms — not a slide). `false`
  // while the old script's content is swapped for the new one underneath.
  const [doorVisible, setDoorVisible] = useState(true);
  const isFirstRun = useRef(true);

  useEffect(() => {
    const active = DOORS[variant];
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let loopTimer: ReturnType<typeof setTimeout>;
    let fadeTimer: ReturnType<typeof setTimeout>;

    const startLoop = () => {
      if (reducedMotion) {
        dispatch(() => active.reduced);
        return;
      }
      dispatch(() => active.start);
      let i = 1;
      const tick = () => {
        dispatch(active.script[i].step);
        i = (i + 1) % active.script.length;
        loopTimer = setTimeout(tick, active.script[i].delay);
      };
      loopTimer = setTimeout(tick, active.script[1].delay);
    };

    if (isFirstRun.current || reducedMotion) {
      isFirstRun.current = false;
      startLoop();
    } else {
      setDoorVisible(false);
      fadeTimer = setTimeout(() => {
        setDoorVisible(true);
        startLoop();
      }, 100);
    }

    return () => {
      clearTimeout(loopTimer);
      clearTimeout(fadeTimer);
    };
  }, [variant]);

  const skin = SKIN[state.channel];
  const platform = PLATFORMS[state.channel];
  const visibleMessages = state.messages.slice(-4);
  const feed = state.alerts.slice(-3);
  const hasActivity = state.orderStatus !== 'none' || state.stockVisible || state.alerts.length > 0;
  const initial = door.customerName.charAt(0);

  return (
    <div
      className={cn(
        'relative isolate mx-auto w-full max-w-xl transition-opacity duration-100 motion-reduce:transition-none',
        doorVisible ? 'opacity-100' : 'opacity-0',
        className,
      )}
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

      {/*
        `sm:h-[360px]` locks the WHOLE two-card row to one constant height.
        `items-start` on the page-level grid (page.tsx) only pins content to
        the top of a track — it doesn't stop a row-spanning item from
        growing the track itself. The dashboard panel's height was already
        pinned with reserved slots below, but the chat card only had a
        `min-h` on its message area, so long wrapped lines / the typing
        bubble / the handoff banner could still grow it, which grew this
        component's total height, which grew the grid rows it spans, which
        pushed the H1 in column 1 down. Fixing both cards to `h-full` inside
        a fixed-height row removes the growth at the source instead of
        chasing it downstream.
      */}
      <div className="grid grid-cols-1 gap-3 sm:h-[360px] sm:grid-cols-[1.25fr_1fr]">
        {/* ── Customer chat (skinned per channel) ───────────────────── */}
        <div className="flex flex-col overflow-hidden rounded-2xl bg-card shadow-xl ring-1 ring-foreground/10 sm:h-full">
          {/* App-style header */}
          <div className={cn('flex items-center gap-2.5 px-3 py-2.5', skin.header)}>
            <ChevronLeft className="size-5 shrink-0 opacity-70" />
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-black/10 text-sm font-semibold dark:bg-white/15">
              {initial}
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-semibold">{door.customerName}</p>
              <p className={cn('truncate text-[11px]', skin.sub)}>
                {state.typing ? <span className="italic">typing…</span> : 'online'}
              </p>
            </div>
            <PlatformBadge platform={state.channel} className="size-6 rounded-lg" iconClassName="size-3.5" />
            <Video className="size-5 shrink-0 opacity-70" />
            <Phone className="size-4 shrink-0 opacity-70" />
          </div>

          {/* Conversation area — flex-1 fills whatever the now-fixed card
              height leaves after the header/input bars, and overflow-hidden
              is the backstop: if a frame's content is ever taller than that
              (a wrapped long line, the typing dots, the handoff banner), it
              clips at the top instead of growing the box. */}
          <div className={cn('relative flex flex-1 flex-col justify-end gap-1.5 overflow-hidden px-3 py-3', skin.area)}>
            {skin.doodle && <ChatBackdrop />}

            <div className="relative flex flex-col gap-1.5">
              <div className="mb-1 flex justify-center">
                <span className="rounded-md bg-black/5 px-2 py-0.5 text-[10px] font-medium text-foreground/50 shadow-sm dark:bg-white/10 dark:text-white/50">
                  Today
                </span>
              </div>

              {visibleMessages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    'flex motion-reduce:animate-none',
                    // Customer bubble just fades in — the typed text below does the
                    // reveal. The AI reply lands as a landed object (scale + opacity,
                    // no slide) per docs/27 §6.2 item 1.
                    m.role === 'customer'
                      ? 'animate-in fade-in justify-start duration-150'
                      : 'animate-in zoom-in-95 fade-in justify-end duration-[180ms]',
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[82%] rounded-2xl px-2.5 py-1.5 text-[13px] leading-snug shadow-sm',
                      m.role === 'customer' ? skin.incoming : skin.outgoing,
                    )}
                  >
                    <span>{m.role === 'customer' ? <TypedText text={m.text} /> : m.text}</span>
                    <span className="mt-0.5 flex items-center justify-end gap-1 text-[10px] opacity-70">
                      {m.role === 'ai' && <Sparkles className="size-2.5" />}
                      {clock(m.id)}
                      {m.role === 'ai' && <CheckCheck className={cn('size-3', skin.tick)} />}
                    </span>
                  </div>
                </div>
              ))}

              {state.handoff && (
                <div className="animate-in fade-in zoom-in-95 mt-1 flex justify-center duration-300 motion-reduce:animate-none">
                  <span className="flex items-center gap-1 rounded-full bg-violet-500/15 px-2.5 py-0.5 text-[10px] font-medium text-violet-700 shadow-sm dark:text-violet-300">
                    <LifeBuoy className="size-3" />
                    The owner joined the chat
                  </span>
                </div>
              )}

              {state.typing && (
                <div className="animate-in fade-in zoom-in-95 flex justify-start duration-200 motion-reduce:animate-none">
                  <div className={cn('flex items-center gap-1 rounded-2xl rounded-bl-sm px-3 py-2.5 shadow-sm', skin.incoming)}>
                    <span className="size-1.5 animate-bounce rounded-full bg-current opacity-40 [animation-delay:-0.3s]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-current opacity-40 [animation-delay:-0.15s]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-current opacity-40" />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* App-style input bar */}
          <div className={cn('flex items-center gap-2 px-2.5 py-2', skin.area)}>
            <div className="flex flex-1 items-center gap-2 rounded-full bg-card px-3 py-1.5 text-muted-foreground shadow-sm ring-1 ring-foreground/5">
              <Smile className="size-4 shrink-0 opacity-60" />
              <span className="flex-1 truncate text-xs">Message</span>
              <Plus className="size-4 shrink-0 opacity-60" />
            </div>
            <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full shadow-sm', skin.accent)}>
              <Mic className="size-4" />
            </span>
          </div>
        </div>

        {/*
          ── Live dashboard ──────────────────────────────────────────
          Hidden below `sm` (the same breakpoint this component's own grid
          already uses to decide side-by-side vs stacked): below that width
          this panel stacked BENEATH the chat panel instead of beside it,
          adding ~200px+ its own height on the narrowest phones — on top of
          the chat panel's own ~330px+, that alone pushed every message
          bubble below the fold at 664px (docs/27 §3 M2, D-05). The chat
          panel is the part the page's message actually depends on; this is
          secondary proof, not lost, just not competing for the fold.
        */}
        <div className="hidden flex-col gap-2.5 rounded-2xl bg-card p-3.5 shadow-xl ring-1 ring-foreground/10 sm:flex sm:h-full">
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

          {/*
            Order card, inventory row, and the alert feed below are all kept
            permanently mounted and toggled with `invisible` (reserves the
            box, hides the paint) rather than conditionally rendered. This
            panel sits beside the customer chat inside a shared-height grid,
            and that grid is itself spanned by this whole component in the
            page's hero (docs/27 §6 motion note). Mounting/unmounting these
            let the panel's height grow across the ~14s script loop, which
            grew this component's own height and, through the outer grid's
            row-span on it, visibly pushed the hero H1 down mid-loop. Fixed
            slots keep the panel's height constant from first paint.
          */}
          <div
            className={cn(
              'rounded-xl border border-border bg-background/60 p-2.5 transition-opacity duration-300',
              state.orderStatus === 'none'
                ? 'invisible'
                : 'animate-in fade-in slide-in-from-right-2 motion-reduce:animate-none',
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">{door.orderLabel}</span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset transition-colors duration-300',
                  STATUS_CLS[state.orderStatus === 'none' ? 'new' : state.orderStatus],
                )}
              >
                {door.statusLabels[state.orderStatus === 'none' ? 'new' : state.orderStatus]}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="truncate text-xs text-foreground">{door.orderLine}</span>
              <span className="shrink-0 text-xs font-semibold text-foreground">{door.orderPrice}</span>
            </div>
          </div>

          {/* Inventory row */}
          <div
            className={cn(
              'flex items-center justify-between gap-2 rounded-xl border border-border bg-background/60 px-2.5 py-2 transition-opacity duration-300',
              state.stockVisible
                ? 'animate-in fade-in slide-in-from-right-2 motion-reduce:animate-none'
                : 'invisible',
            )}
          >
            <span className="truncate text-xs text-foreground">{door.stockName}</span>
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset transition-colors duration-300',
                state.stock === 0
                  ? 'bg-red-500/10 text-red-600 ring-red-500/20 dark:text-red-400'
                  : 'bg-amber-500/10 text-amber-600 ring-amber-500/20 dark:text-amber-400',
              )}
            >
              {state.stock === 0 ? door.stockEmptyLabel : `${state.stock} left`}
            </span>
          </div>

          {/* Alerts feed — always 3 slots so the list can't grow the panel as entries accumulate. */}
          <div className="flex flex-col gap-1.5">
            {[0, 1, 2].map((slot) => {
              const a = feed[slot];
              if (a) {
                const Icon = ALERT_META[a.kind].icon;
                return (
                  <div
                    key={a.id}
                    className="animate-in fade-in slide-in-from-bottom-1 flex items-center gap-1.5 text-[11px] text-muted-foreground duration-300 motion-reduce:animate-none"
                  >
                    <Icon className={cn('size-3.5 shrink-0', ALERT_META[a.kind].cls)} />
                    <span className="truncate">{a.text}</span>
                  </div>
                );
              }
              if (slot === 0 && !hasActivity) {
                return (
                  <div key="placeholder" className="text-[11px] text-muted-foreground">
                    Watching your channels…
                  </div>
                );
              }
              return <div key={`empty-${slot}`} aria-hidden className="h-[17px]" />;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
