import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * Standardizes the many bare "No X yet." strings into something that guides the
 * next action (docs/14 §7.1). `cta` is a fully-formed element (Link or Button)
 * so callers keep control over navigation vs. an inline action.
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  cta,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  cta?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl bg-card p-10 text-center ring-1 ring-foreground/10">
      <Icon className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>}
      {cta && <div className="mt-2">{cta}</div>}
    </div>
  );
}
