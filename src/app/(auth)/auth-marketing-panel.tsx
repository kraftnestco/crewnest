'use client';

import { useEffect, useState } from 'react';
import { BookOpen, CalendarDays, Lock, ShieldCheck, Sparkles, Tag, User, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PlatformBadge, type PlatformId } from '@/app/_landing/platform-icons';
import { cn } from '@/lib/utils';

interface Exchange {
  label: string;
  customer: string;
  ai: string;
  /** Second turn — proves the assistant holds context, not just one-shot Q&A. */
  followUp: string;
  followUpAi: string;
}

const EXCHANGES: Exchange[] = [
  {
    label: 'Product question',
    customer: 'Do you have the Sea Green kurta in medium?',
    ai: 'Yes — medium is in stock, Rs. 2,500. Want me to place the order?',
    followUp: 'Yes. Can I get it by Friday?',
    followUpAi: 'Absolutely — delivery to Lahore is available by Thursday.',
  },
  {
    label: 'Booking',
    customer: 'Can I get a haircut slot today at 4?',
    ai: "4:00 PM is open — you're booked in. See you then!",
    followUp: 'Can my brother come at the same time?',
    followUpAi: "Added him to 4:00 PM as well — both chairs are reserved.",
  },
  {
    label: 'Store info',
    customer: 'Is this the branch on Main Street?',
    ai: "That's us! Anything else I can check, or want a teammate to jump in?",
    followUp: 'What time do you close today?',
    followUpAi: 'We close at 9 PM tonight, and we open again at 11 AM tomorrow.',
  },
];

const PROOF_CHIPS: { icon: LucideIcon; label: string }[] = [
  { icon: BookOpen, label: 'Live catalogue' },
  { icon: Tag, label: 'Real pricing' },
  { icon: CalendarDays, label: 'Calendar aware' },
];

const CHANNELS: { id: PlatformId; label: string }[] = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'messenger', label: 'Messenger' },
  { id: 'web', label: 'Website chat' },
];

const TRUST_ICONS: LucideIcon[] = [ShieldCheck, Lock, Zap];

type Phase = 'typing' | 'thinking' | 'reply' | 'typing-2' | 'thinking-2' | 'reply-2';

const TYPE_MS = 22;
const THINK_MS = 550;
const BETWEEN_TURNS_MS = 1100;
const HOLD_MS = 2000;
const FADE_MS = 220;

function Avatar() {
  return (
    <span className="mt-auto inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-stage-deep-fg/70">
      <User className="size-3.5" aria-hidden />
    </span>
  );
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 rounded-2xl rounded-br-md bg-white/95 px-3.5 py-2.5">
      <span className="size-1.5 animate-bounce rounded-full bg-stage-deep [animation-delay:-0.3s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-stage-deep [animation-delay:-0.15s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-stage-deep" />
    </div>
  );
}

function AiBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex max-w-[78%] animate-in items-start gap-1.5 rounded-2xl rounded-br-md bg-white/95 fade-in zoom-in-95 px-3.5 py-2 text-sm text-stage-deep duration-200 motion-reduce:animate-none">
      <Sparkles className="mt-0.5 size-3.5 shrink-0 opacity-70" />
      {children}
    </div>
  );
}

/**
 * The login/signup marketing panel's live proof — cycles the exchanges above
 * on a timer, reusing the hero demo's motion language (typed reveal, a
 * thinking beat, a landed AI reply) so the auth pages don't feel like a
 * separate, static product from the marketing site. Each exchange runs two
 * turns, since the follow-up is what shows the assistant is holding context.
 *
 * Starts in the "motion on" shape on both server and first client render —
 * render never touches `window`, so there's nothing for hydration to
 * mismatch. A mount-only effect checks prefers-reduced-motion and, if set,
 * jumps straight to one fully-typed static frame instead of starting the
 * timer loop.
 */
export function AuthMarketingPanel() {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('typing');
  const [typed, setTyped] = useState('');
  const [typedFollowUp, setTypedFollowUp] = useState('');
  const [visible, setVisible] = useState(true);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setReduced(true);
      setTyped(EXCHANGES[0].customer);
      setTypedFollowUp(EXCHANGES[0].followUp);
      setPhase('reply-2');
    }
  }, []);

  useEffect(() => {
    if (reduced) return;
    const exchange = EXCHANGES[index];
    const timers: ReturnType<typeof setTimeout>[] = [];

    const type = (text: string, onDone: () => void, write: (value: string) => void) => {
      write('');
      let i = 0;
      const step = () => {
        i += 1;
        write(text.slice(0, i));
        if (i < text.length) {
          timers.push(setTimeout(step, TYPE_MS + Math.random() * 18));
        } else {
          timers.push(setTimeout(onDone, 260));
        }
      };
      timers.push(setTimeout(step, TYPE_MS));
    };

    if (phase === 'typing') {
      setTypedFollowUp('');
      type(exchange.customer, () => setPhase('thinking'), setTyped);
    } else if (phase === 'thinking') {
      timers.push(setTimeout(() => setPhase('reply'), THINK_MS));
    } else if (phase === 'reply') {
      timers.push(setTimeout(() => setPhase('typing-2'), BETWEEN_TURNS_MS));
    } else if (phase === 'typing-2') {
      type(exchange.followUp, () => setPhase('thinking-2'), setTypedFollowUp);
    } else if (phase === 'thinking-2') {
      timers.push(setTimeout(() => setPhase('reply-2'), THINK_MS));
    } else {
      timers.push(
        setTimeout(() => {
          setVisible(false);
          timers.push(
            setTimeout(() => {
              setIndex((i) => (i + 1) % EXCHANGES.length);
              setVisible(true);
              setPhase('typing');
            }, FADE_MS),
          );
        }, HOLD_MS),
      );
    }

    return () => timers.forEach(clearTimeout);
  }, [phase, index, reduced]);

  const exchange = EXCHANGES[index];
  const showCursor = !reduced && phase === 'typing' && typed.length < exchange.customer.length;
  const showFollowUpCursor =
    !reduced && phase === 'typing-2' && typedFollowUp.length < exchange.followUp.length;
  const turnTwoStarted = phase === 'typing-2' || phase === 'thinking-2' || phase === 'reply-2';

  return (
    <div className="relative mx-auto w-full max-w-2xl">
      <h2 className="font-hero-display text-3xl tracking-tight text-balance">
        Every customer message, answered instantly.
      </h2>
      <p className="mt-3 max-w-md text-sm text-stage-deep-fg/80">
        Grounded in your actual catalogue and calendar — never a generic script, never a made-up price.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {PROOF_CHIPS.map(({ icon: Icon, label }) => (
          <span
            key={label}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-xs ring-1 ring-white/10"
          >
            <Icon className="size-3.5 opacity-70" aria-hidden />
            {label}
          </span>
        ))}
      </div>

      <div className="mt-6 flex items-stretch">
        <div
          className={cn(
            'min-w-0 flex-1 transition-opacity duration-200 motion-reduce:transition-none',
            visible ? 'opacity-100' : 'opacity-0',
          )}
        >
          <div className="flex min-h-[16.5rem] flex-col gap-2.5 rounded-2xl bg-white/[0.05] p-4 ring-1 ring-white/10">
            <span className="inline-flex w-fit items-center rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-stage-deep-fg/70 uppercase">
              {exchange.label}
            </span>

            <div className="flex items-end gap-2">
              <Avatar />
              <div className="min-h-9 max-w-[78%] rounded-2xl rounded-bl-md bg-white/10 px-3.5 py-2 text-sm">
                {reduced ? exchange.customer : typed}
                {showCursor && (
                  <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-current" />
                )}
              </div>
            </div>

            {phase !== 'typing' && (
              <div className="flex justify-end">
                {phase === 'thinking' ? <ThinkingDots /> : <AiBubble>{exchange.ai}</AiBubble>}
              </div>
            )}

            {turnTwoStarted && (
              <div className="flex items-end gap-2">
                <Avatar />
                <div className="min-h-9 max-w-[78%] rounded-2xl rounded-bl-md bg-white/10 px-3.5 py-2 text-sm">
                  {reduced ? exchange.followUp : typedFollowUp}
                  {showFollowUpCursor && (
                    <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-current" />
                  )}
                </div>
              </div>
            )}

            {(phase === 'thinking-2' || phase === 'reply-2') && (
              <div className="flex items-end justify-end gap-2">
                {phase === 'thinking-2' ? (
                  <ThinkingDots />
                ) : (
                  <>
                    <AiBubble>{exchange.followUpAi}</AiBubble>
                    <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/25 text-primary ring-1 ring-primary/40">
                      <Sparkles className="size-3.5" aria-hidden />
                    </span>
                  </>
                )}
              </div>
            )}

            <div className="mt-auto flex items-center justify-between gap-3 pt-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] text-stage-deep-fg/70">
                <span className="size-1.5 rounded-full bg-success" />
                AI assistant online · 24/7
              </span>
              <span className="flex items-center gap-1.5" aria-hidden>
                {TRUST_ICONS.map((Icon, i) => (
                  <span
                    key={i}
                    className="inline-flex size-6 items-center justify-center rounded-md bg-white/[0.06] text-stage-deep-fg/60 ring-1 ring-white/10"
                  >
                    <Icon className="size-3" />
                  </span>
                ))}
              </span>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-center gap-1.5" aria-hidden="true">
            {EXCHANGES.map((e, i) => (
              <span
                key={e.label}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-300',
                  i === index ? 'w-5 bg-stage-deep-fg/80' : 'w-1.5 bg-stage-deep-fg/25',
                )}
              />
            ))}
          </div>
        </div>

        {/* Channel rail — the same message flow, whichever inbox it arrives in. */}
        <div className="hidden shrink-0 items-stretch xl:flex">
          <svg
            aria-hidden
            viewBox="0 0 40 240"
            preserveAspectRatio="none"
            className="h-full w-10 text-stage-deep-fg/20"
          >
            <path d="M0 120 H20" stroke="currentColor" strokeWidth="1" fill="none" />
            <path d="M20 26 V214" stroke="currentColor" strokeWidth="1" fill="none" />
            {[26, 88, 150, 214].map((y) => (
              <path key={y} d={`M20 ${y} H40`} stroke="currentColor" strokeWidth="1" fill="none" />
            ))}
          </svg>

          <div className="flex w-44 flex-col justify-between py-1">
            {CHANNELS.map((channel) => (
              <div
                key={channel.id}
                className="flex items-center gap-2 rounded-xl bg-white/[0.07] px-3 py-2 ring-1 ring-white/10"
              >
                <PlatformBadge
                  platform={channel.id}
                  className="size-6 rounded-lg shadow-none"
                  iconClassName="size-3.5"
                />
                <span className="text-xs font-medium">{channel.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
