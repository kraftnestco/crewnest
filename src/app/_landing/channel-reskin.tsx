'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCheck, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PLATFORMS, PlatformBadge, type PlatformId } from './platform-icons';
import { SKIN } from './hero-visual';

const STOPS: { id: PlatformId; customer: string; ai: string }[] = [
  { id: 'whatsapp', customer: 'Are you open right now?', ai: 'Yes! Open till 9 PM today 😊' },
  { id: 'instagram', customer: 'Obsessed with this 😍 is it in stock?', ai: 'It is! Want me to hold one for you?' },
  { id: 'messenger', customer: 'Can I pay cash on delivery?', ai: 'Of course — COD works for this order.' },
];

/**
 * One representative brand hex per channel, driving the ambient backdrop
 * glow below — separate from SKIN's Tailwind classes (two of which are
 * gradients, not a single colour) because a radial-gradient glow needs one
 * concrete hex to fade from.
 */
const GLOW: Record<PlatformId, string> = {
  whatsapp: '#25D366',
  instagram: '#d62976',
  messenger: '#0084ff',
  web: '#737373',
};

/**
 * Motion item 4 (docs/27 §6.2 / §9 Phase 10) — the "biggest single wow".
 * `position: sticky` pins the phone while a tall driver track scrolls past
 * it; the active index (which channel skin is showing) is derived from
 * scroll position and drives an opacity/transform-only cross-fade between
 * three permanently-mounted, absolutely-stacked cards — never height/width,
 * per §6.3.
 *
 * The scroll listener is the one place on the marketing page allowed to
 * continuously scrub (§6.3's sole exception), so it's kept as cheap as
 * possible for the "tested on a low-end Android profile" requirement: an
 * IntersectionObserver attaches/detaches the `scroll` listener only while
 * the driver is actually on screen, and every scroll tick is coalesced to
 * at most one `requestAnimationFrame` read.
 */
export function ChannelReskin() {
  const driverRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- media query is only available after mount
    setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const driver = driverRef.current;
    if (!driver) return;

    let ticking = false;

    const computeActive = () => {
      ticking = false;
      const rect = driver.getBoundingClientRect();
      const scrollable = rect.height - window.innerHeight;
      if (scrollable <= 0) return;
      const progress = Math.min(1, Math.max(0, -rect.top / scrollable));
      setActive(Math.min(STOPS.length - 1, Math.floor(progress * STOPS.length)));
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(computeActive);
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          computeActive();
          window.addEventListener('scroll', onScroll, { passive: true });
        } else {
          window.removeEventListener('scroll', onScroll);
        }
      },
      { threshold: 0 },
    );
    io.observe(driver);

    return () => {
      io.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, [reducedMotion]);

  // No pinned/scroll-jacked track for reduced-motion users — the same three
  // cards, laid out flat with normal document flow (§6.3).
  if (reducedMotion) {
    return (
      <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-3">
        {STOPS.map((stop) => (
          <div key={stop.id} className="relative">
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-6 -z-10 rounded-[2.5rem] opacity-40 blur-2xl"
              style={{ background: `radial-gradient(circle, ${GLOW[stop.id]}, transparent 70%)` }}
            />
            <ChannelCard stop={stop} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div ref={driverRef} className="relative h-[240vh]">
      <div className="sticky top-28 mx-auto w-full max-w-sm">
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-24 -inset-y-32 -z-10 sm:-inset-x-40"
        >
          {STOPS.map((stop, i) => (
            <div
              key={stop.id}
              className="absolute inset-0 rounded-full blur-3xl transition-opacity duration-700 ease-out"
              style={{
                background: `radial-gradient(ellipse 55% 45% at 50% 45%, ${GLOW[stop.id]}, transparent 70%)`,
                opacity: i === active ? 0.35 : 0,
              }}
            />
          ))}
        </div>
        <div className="relative h-[320px]">
          {STOPS.map((stop, i) => (
            <div
              key={stop.id}
              aria-hidden={i !== active}
              className={cn(
                'absolute inset-0 transition-[opacity,transform] duration-500 ease-out',
                i === active ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
              )}
            >
              <ChannelCard stop={stop} />
            </div>
          ))}
        </div>
        <div className="mt-6 flex items-center justify-center gap-3">
          {STOPS.map((stop, i) => (
            <PlatformBadge
              key={stop.id}
              platform={stop.id}
              className={cn(
                'rounded-full transition-all duration-300',
                i === active ? 'size-9 ring-2 ring-stage-warm-fg/40' : 'size-8 opacity-40',
              )}
              iconClassName="size-3.5"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ChannelCard({ stop }: { stop: (typeof STOPS)[number] }) {
  const skin = SKIN[stop.id];
  return (
    <div className="h-full overflow-hidden rounded-[2rem] bg-card shadow-2xl ring-1 ring-foreground/10">
      <div className={cn('flex items-center gap-2.5 px-4 py-3', skin.header)}>
        <PlatformBadge platform={stop.id} className="size-8 rounded-full" iconClassName="size-3.5" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold">{PLATFORMS[stop.id].label}</p>
          <p className={cn('truncate text-[11px]', skin.sub)}>Your AI employee</p>
        </div>
      </div>
      <div className={cn('flex h-[calc(100%-56px)] flex-col justify-center gap-2.5 px-4 py-6', skin.area)}>
        <div className="flex justify-start">
          <div className={cn('max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm', skin.incoming)}>
            {stop.customer}
          </div>
        </div>
        <div className="flex justify-end">
          <div className={cn('max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm', skin.outgoing)}>
            <span>{stop.ai}</span>
            <span className="mt-0.5 flex items-center justify-end gap-1 text-[10px] opacity-70">
              <Sparkles className="size-2.5" />
              <CheckCheck className={cn('size-3', skin.tick)} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
