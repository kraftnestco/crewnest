import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * docs/27 §2/§7.7 — the `--success`/`--pending`/`--danger` tokens' one consumer
 * for badge-shaped status. Colour is never the only signal: `children` always
 * carries the word (D-12 was "pending has no colour AND no word").
 */
const TONE_CLASS: Record<'success' | 'pending' | 'danger' | 'neutral', string> = {
  success: 'bg-success-tint text-success-text',
  pending: 'bg-pending-tint text-pending-text',
  danger: 'bg-danger-tint text-danger-text',
  neutral: 'bg-muted text-muted-foreground',
};

export function StatusPill({
  tone,
  children,
  className,
}: {
  tone: 'success' | 'pending' | 'danger' | 'neutral';
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-tight',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
