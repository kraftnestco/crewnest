'use client';

import { useEffect, useState } from 'react';
import { CheckCheck, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TiltCard } from './tilt-card';
import { PLATFORMS, PlatformBadge, type PlatformId } from './platform-icons';

const CHANNEL_IDS: PlatformId[] = ['whatsapp', 'instagram', 'messenger', 'web'];
const CUSTOMER_LINES: Record<PlatformId, string> = {
  whatsapp: 'Do you have this in size M?',
  instagram: 'Is this still in stock?',
  messenger: 'Can I pay on delivery?',
  web: 'What are your delivery charges?',
};
const AI_LINES: Record<PlatformId, string> = {
  whatsapp: 'Yes! 2 left in Sea Green — want me to hold one for you?',
  instagram: 'Just checked, it’s in stock and ready to ship today.',
  messenger: 'Yes, cash on delivery is available in your area.',
  web: 'Free above Rs. 3,000, otherwise a flat Rs. 200.',
};

// Corner placement + a per-badge tilt so the orbit doesn't look mechanically uniform.
const ORBIT_POSITION: Record<PlatformId, string> = {
  whatsapp: '-top-3 -left-9',
  instagram: '-top-3 -right-9',
  messenger: '-bottom-6 -left-10',
  web: '-bottom-6 -right-10',
};
const ORBIT_ROTATE: Record<PlatformId, string> = {
  whatsapp: '-8deg',
  instagram: '10deg',
  messenger: '7deg',
  web: '-6deg',
};

const STAGE_MS = 1900;

/**
 * Looping conversation mock: 0 customer asks, 1 typing, 2 AI replies, 3 synced.
 * The four platform badges orbiting the card double as channel switchers —
 * hover (or focus/tap) previews that channel's conversation, click pins it.
 */
export function HeroVisual() {
  const [tick, setTick] = useState(0);
  const [pinned, setPinned] = useState<PlatformId | null>(null);
  const [hovered, setHovered] = useState<PlatformId | null>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setTick((t) => t + 1), STAGE_MS);
    return () => clearInterval(id);
  }, []);

  const autoChannel = CHANNEL_IDS[Math.floor(tick / 4) % CHANNEL_IDS.length];
  const channel = hovered ?? pinned ?? autoChannel;
  const stage = tick % 4;

  return (
    <div
      className="relative isolate mx-auto w-full max-w-sm"
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse') return;
        const rect = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty('--mx', `${((e.clientX - rect.left) / rect.width) * 100}%`);
        e.currentTarget.style.setProperty('--my', `${((e.clientY - rect.top) / rect.height) * 100}%`);
      }}
    >
      <div className="pointer-events-none absolute -inset-24 -z-10 opacity-80 [background:radial-gradient(380px_circle_at_var(--mx,50%)_var(--my,30%),color-mix(in_oklch,var(--foreground)_8%,transparent),transparent_70%)]" />

      <div
        className="animate-float pointer-events-none absolute -top-9 left-1/2 z-10 -translate-x-1/2"
        style={{ '--float-rotate': '0deg' } as React.CSSProperties}
      >
        <div className="flex items-center gap-1 rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background shadow-lg">
          <Sparkles className="size-3.5" />
          Never misses a message
        </div>
      </div>

      {CHANNEL_IDS.map((id, i) => (
        <button
          key={id}
          type="button"
          aria-pressed={channel === id}
          aria-label={`Preview the ${PLATFORMS[id].label} conversation`}
          onMouseEnter={() => setHovered(id)}
          onMouseLeave={() => setHovered(null)}
          onFocus={() => setHovered(id)}
          onBlur={() => setHovered(null)}
          onClick={() => setPinned((p) => (p === id ? null : id))}
          className={cn('animate-float absolute z-10 cursor-pointer', ORBIT_POSITION[id])}
          style={{ '--float-rotate': ORBIT_ROTATE[id], animationDelay: `${i * 0.4}s` } as React.CSSProperties}
        >
          <PlatformBadge
            platform={id}
            className={cn(
              'shadow-lg ring-2 ring-background transition-all duration-200',
              channel === id ? 'scale-110 ring-foreground/30' : 'scale-90 opacity-70 hover:scale-100 hover:opacity-100',
            )}
          />
        </button>
      ))}

      <TiltCard>
        <div className="w-full rounded-2xl bg-card p-4 shadow-xl ring-1 ring-foreground/10">
          <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              <span className="text-xs font-medium text-muted-foreground">Live · AI Employee</span>
            </div>
            <span className="text-xs text-muted-foreground">via {PLATFORMS[channel].label}</span>
          </div>

          <div className="flex flex-col gap-2 pt-3">
            <div className="self-start max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm text-foreground">
              {CUSTOMER_LINES[channel]}
            </div>

            <div className="flex min-h-9 justify-end">
              {stage === 1 && (
                <div className="flex items-center gap-1 rounded-2xl rounded-br-sm bg-foreground/10 px-3 py-2">
                  <span className="size-1.5 animate-bounce rounded-full bg-foreground/50 [animation-delay:-0.3s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-foreground/50 [animation-delay:-0.15s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-foreground/50" />
                </div>
              )}
              {stage >= 2 && (
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-foreground px-3 py-2 text-sm text-background">
                  {AI_LINES[channel]}
                </div>
              )}
            </div>

            <div
              className={cn(
                'flex items-center gap-1 text-xs text-muted-foreground transition-opacity duration-300',
                stage === 3 ? 'opacity-100' : 'opacity-0',
              )}
            >
              <CheckCheck className="size-3.5" />
              Synced to your dashboard
            </div>
          </div>
        </div>
      </TiltCard>
    </div>
  );
}
