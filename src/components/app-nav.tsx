'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

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
 * Mobile bottom tab bar — first five items, visible below `lg`. Layouts pad
 * their scroll area (`pb-16 lg:pb-0`) so content never hides behind it.
 */
export function MobileTabBar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      {items.slice(0, 5).map((item) => {
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
    </nav>
  );
}
