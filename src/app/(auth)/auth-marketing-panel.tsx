'use client';

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Exchange {
  label: string;
  customer: string;
  ai: string;
}

const EXCHANGES: Exchange[] = [
  {
    label: 'Product question',
    customer: 'Do you have the Sea Green kurta in medium?',
    ai: 'Yes — medium is in stock, Rs. 2,500. Want me to place the order?',
  },
  {
    label: 'Booking',
    customer: 'Can I get a haircut slot today at 4?',
    ai: "4:00 PM is open — you're booked in. See you then!",
  },
  {
    label: 'Store info',
    customer: 'Is this the branch on Main Street?',
    ai: "That's us! Anything else I can check, or want a teammate to jump in?",
  },
];

type Phase = 'typing' | 'thinking' | 'reply';

const TYPE_MS = 22;
const THINK_MS = 550;
const HOLD_MS = 2200;
const FADE_MS = 220;

/**
 * The login/signup marketing panel's live proof — cycles the exchanges above
 * on a timer, reusing the hero demo's motion language (typed reveal, a
 * thinking beat, a landed AI reply) so the auth pages don't feel like a
 * separate, static product from the marketing site.
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
  const [visible, setVisible] = useState(true);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setReduced(true);
      setTyped(EXCHANGES[0].customer);
      setPhase('reply');
    }
  }, []);

  useEffect(() => {
    if (reduced) return;
    const exchange = EXCHANGES[index];
    const timers: ReturnType<typeof setTimeout>[] = [];

    if (phase === 'typing') {
      setTyped('');
      let i = 0;
      const step = () => {
        i += 1;
        setTyped(exchange.customer.slice(0, i));
        if (i < exchange.customer.length) {
          timers.push(setTimeout(step, TYPE_MS + Math.random() * 18));
        } else {
          timers.push(setTimeout(() => setPhase('thinking'), 260));
        }
      };
      timers.push(setTimeout(step, TYPE_MS));
    } else if (phase === 'thinking') {
      timers.push(setTimeout(() => setPhase('reply'), THINK_MS));
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

  return (
    <div className="relative mx-auto max-w-sm">
      <h2 className="font-hero-display text-3xl tracking-tight text-balance">
        Every customer message, answered instantly.
      </h2>
      <p className="mt-3 text-stage-deep-fg/80">
        Grounded in your actual catalogue and calendar — never a generic script, never a made-up price.
      </p>

      <div className={cn('mt-8 transition-opacity duration-200 motion-reduce:transition-none', visible ? 'opacity-100' : 'opacity-0')}>
        <div className="flex flex-col gap-2.5 rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10">
          <span className="mb-1 inline-flex w-fit items-center rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-stage-deep-fg/70 uppercase">
            {exchange.label}
          </span>

          <div className="flex justify-start">
            <div className="min-h-9 max-w-[80%] rounded-2xl rounded-bl-md bg-white/10 px-3.5 py-2 text-sm">
              {reduced ? exchange.customer : typed}
              {showCursor && (
                <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-current" />
              )}
            </div>
          </div>

          {(phase === 'thinking' || phase === 'reply') && (
            <div className="flex justify-end">
              {phase === 'thinking' ? (
                <div className="flex items-center gap-1 rounded-2xl rounded-br-md bg-white/95 px-3.5 py-2.5">
                  <span className="size-1.5 animate-bounce rounded-full bg-stage-deep [animation-delay:-0.3s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-stage-deep [animation-delay:-0.15s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-stage-deep" />
                </div>
              ) : (
                <div className="flex max-w-[80%] animate-in items-start gap-1.5 rounded-2xl rounded-br-md bg-white/95 fade-in zoom-in-95 px-3.5 py-2 text-sm text-stage-deep duration-200 motion-reduce:animate-none">
                  <Sparkles className="mt-0.5 size-3.5 shrink-0 opacity-70" />
                  {exchange.ai}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center gap-1.5" aria-hidden="true">
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
    </div>
  );
}
