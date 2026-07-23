'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export function DashboardNav({ showBusiness }: { showBusiness: boolean }) {
  const pathname = usePathname();

  const items = [
    { href: '/dashboard/chat', label: 'My Inbox' },
    { href: '/dashboard/orders', label: 'My Orders' },
    { href: '/dashboard/analytics', label: 'Analytics' },
    ...(showBusiness ? [{ href: '/dashboard/business', label: 'My Business' }] : []),
    ...(showBusiness ? [{ href: '/dashboard/team', label: 'My Team' }] : []),
  ];

  return (
    <nav className="flex flex-1 flex-col gap-1 px-2">
      {items.map((item) => {
        const isActive = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'rounded-lg px-3 py-2 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              isActive && 'bg-sidebar-accent text-sidebar-accent-foreground font-medium',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
