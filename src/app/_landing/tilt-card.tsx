'use client';

import { useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * Pointer-driven 3D tilt wrapper. Mutates the inner element's transform directly
 * (no React state) so the effect stays smooth without re-rendering on every
 * pointermove. Disabled under prefers-reduced-motion.
 */
export function TiltCard({
  children,
  className,
  innerClassName,
  max = 8,
}: {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
  max?: number;
}) {
  const innerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className={cn('[perspective:1200px]', className)}
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse') return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const el = innerRef.current;
        if (!el) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width;
        const py = (e.clientY - rect.top) / rect.height;
        el.style.setProperty('--ry', `${(px - 0.5) * max * 2}deg`);
        el.style.setProperty('--rx', `${(0.5 - py) * max * 2}deg`);
        el.style.setProperty('--tz', '14px');
      }}
      onPointerLeave={() => {
        const el = innerRef.current;
        if (!el) return;
        el.style.setProperty('--rx', '0deg');
        el.style.setProperty('--ry', '0deg');
        el.style.setProperty('--tz', '0px');
      }}
    >
      <div
        ref={innerRef}
        className={cn(
          'transition-transform duration-200 ease-out [transform:rotateX(var(--rx,0deg))_rotateY(var(--ry,0deg))_translateZ(var(--tz,0px))]',
          innerClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
