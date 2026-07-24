import type { ReactNode } from 'react';

/**
 * Pixel-consistent replacement for the ad-hoc `<h1 className="font-heading …">` +
 * `<p className="text-muted-foreground">` block repeated across Overview, Settings,
 * Orders, Business, etc. (docs/14 §7.1). One sentence of description is required so
 * every screen states what it's for.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="font-hero-display text-xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
