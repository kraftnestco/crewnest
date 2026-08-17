import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type HomeIconTone =
  | 'primary'
  | 'success'
  | 'amber'
  | 'sky'
  | 'violet'
  | 'orange'
  | 'teal'
  | 'rose';

const TONE_CLASS: Record<HomeIconTone, string> = {
  primary: 'bg-primary/15 text-primary',
  success: 'bg-success/15 text-success',
  amber: 'bg-amber-500/15 text-amber-500',
  sky: 'bg-sky-500/15 text-sky-500',
  violet: 'bg-violet-500/15 text-violet-500',
  orange: 'bg-orange-500/15 text-orange-500',
  teal: 'bg-teal-500/15 text-teal-500',
  rose: 'bg-rose-500/15 text-rose-500',
};

/** Rounded square icon tile used on dashboard / admin Home cards. */
export function HomeIcon({
  icon: Icon,
  tone = 'primary',
  className,
}: {
  icon: LucideIcon;
  tone?: HomeIconTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex size-10 shrink-0 items-center justify-center rounded-xl',
        TONE_CLASS[tone],
        className,
      )}
    >
      <Icon className="size-5" aria-hidden />
    </span>
  );
}
