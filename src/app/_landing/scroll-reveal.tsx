'use client';

import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The M6 before/after "With ClerkNest" card (docs/27 §6.2 item 2) — on scroll
 * into view the card goes scale(0.96)→1 + translateY(12px)→0 over 400ms,
 * then the gain rows stagger in at 60ms. Self-contained rather than a
 * generic reveal wrapper: a Server Component can't hand a Client Component
 * JSX built from a render-prop function (functions aren't serializable
 * across that boundary — `items` has to be plain data), so the row markup
 * lives here instead of being composed from page.tsx.
 */
export function BeforeAfterGainCard({ items, className }: { items: readonly string[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- show immediately when motion is reduced; media query is post-mount only
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        'transition-[opacity,transform] duration-[400ms] ease-out motion-reduce:transition-none',
        shown ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-3 scale-[0.96] opacity-0',
        className,
      )}
    >
      <p className="text-sm font-medium text-stage-primary">With ClerkNest</p>
      <ul className="mt-4 space-y-4">
        {items.map((gain, i) => (
          <li
            key={gain}
            className="flex items-start gap-3 transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none"
            style={{
              transitionDelay: shown ? `${400 + i * 60}ms` : '0ms',
              opacity: shown ? 1 : 0,
              transform: shown ? 'translateY(0)' : 'translateY(6px)',
            }}
          >
            <Check className="mt-0.5 size-4 shrink-0 text-stage-primary" />
            <span className="font-medium">{gain}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
