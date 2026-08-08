'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MoreHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Shared navigation primitives (docs/19, Phase U2) — one item list drives both
 * the desktop sidebar and the mobile bottom tab bar, so the two shells (client
 * dashboard + agency admin) stay consistent and phones get a first-class nav
 * instead of a crushed sidebar.
 */
export interface NavItem {
  href: string;
  label: string;
  /** Short label for the mobile tab bar (falls back to `label`). */
  shortLabel?: string;
  icon: LucideIcon;
  /** Match the path exactly (for index routes like /admin) instead of by prefix. */
  exact?: boolean;
}

function isActivePath(pathname: string, item: NavItem): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

/** Desktop sidebar nav — icon + label rows with an emerald active accent bar. */
export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 flex-col gap-0.5 px-2">
      {items.map((item) => {
        const isActive = isActivePath(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
              isActive
                ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
            )}
          >
            <span
              className={cn(
                'absolute left-0 h-4 w-0.5 rounded-full bg-sidebar-primary transition-opacity',
                isActive ? 'opacity-100' : 'opacity-0',
              )}
            />
            <item.icon
              className={cn('h-4 w-4 shrink-0', isActive ? 'text-sidebar-primary' : 'text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80')}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Mobile bottom tab bar — visible below `lg`. Layouts pad their scroll area
 * (`pb-16 lg:pb-0`) so content never hides behind it.
 *
 * Used to silently `.slice(0, 5)` and drop everything past the fifth item —
 * for a tenant_admin with booking on, that dropped My Business, Inventory, My
 * Team and Billing off the bar entirely, with NO overflow escape anywhere in
 * the mobile UI (docs/27 §7A D-08/§7.6). Now: up to five items show directly;
 * a sixth-and-beyond set collapses the FIRST FOUR plus a "More" tab that opens
 * every remaining destination in a menu anchored above the bar. Every nav
 * destination stays reachable — at most one extra tap, never zero taps.
 */
export function MobileTabBar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const overflowing = items.length > 5;
  const visibleItems = overflowing ? items.slice(0, 4) : items;
  const overflowItems = overflowing ? items.slice(4) : [];
  const overflowActive = overflowItems.some((item) => isActivePath(pathname, item));

  return (
    /*
     * A flex sibling of <main>, not `fixed`.
     *
     * As a fixed overlay it sat ON TOP of the scroll area, so <main> had to
     * pad its own bottom by the bar's height to keep the last row visible —
     * and that padding read as a block of empty space you could scroll into
     * below the content. In the flex column it reserves its height naturally,
     * <main> ends exactly where it begins, and there is nothing to compensate
     * for. `shrink-0` keeps it from being squeezed by a tall page.
     */
    <nav data-slot="tab-bar" className="z-40 flex shrink-0 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      {visibleItems.map((item) => {
        const isActive = isActivePath(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex min-w-0 flex-1 flex-col items-center gap-1 py-2 text-[10px] font-medium transition-colors',
              isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <item.icon className="h-5 w-5" />
            <span className="truncate">{item.shortLabel ?? item.label}</span>
          </Link>
        );
      })}
      {overflowing && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              'flex min-w-0 flex-1 flex-col items-center gap-1 py-2 text-[10px] font-medium transition-colors',
              overflowActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <MoreHorizontal className="h-5 w-5" />
            <span className="truncate">More</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="mb-1 min-w-48">
            {overflowItems.map((item) => {
              const isActive = isActivePath(pathname, item);
              return (
                <DropdownMenuItem key={item.href} render={<Link href={item.href} />} className={isActive ? 'text-primary' : undefined}>
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </nav>
  );
}
