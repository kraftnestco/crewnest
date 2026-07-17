import { Bird } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Logomark({ className }: { className?: string }) {
  return (
    <span className={cn('relative inline-flex size-8 shrink-0 items-center justify-center', className)}>
      <span className="absolute inset-0 -rotate-6 rounded-lg bg-foreground/15" />
      <span className="relative flex size-7 rotate-3 items-center justify-center rounded-lg bg-foreground text-background shadow-sm">
        <Bird className="size-4" />
      </span>
    </span>
  );
}
