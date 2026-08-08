'use client';

import {
  Boxes,
  CalendarDays,
  ChartNoAxesColumn,
  CreditCard,
  House,
  MessagesSquare,
  Package,
  Store,
  Users,
} from 'lucide-react';
import { SidebarNav, MobileTabBar, type NavItem } from '@/components/app-nav';

/**
 * Client-dashboard nav items (docs/19, Phase U2). One list drives both the
 * desktop sidebar and the mobile bottom tab bar. Home is exact-match so it
 * doesn't stay lit on every child route.
 */
function buildItems(showBusiness: boolean, showBookings: boolean): NavItem[] {
  return [
    { href: '/dashboard', label: 'Home', icon: House, exact: true },
    { href: '/dashboard/chat', label: 'My Inbox', shortLabel: 'Inbox', icon: MessagesSquare },
    { href: '/dashboard/orders', label: 'My Orders', shortLabel: 'Orders', icon: Package },
    // Only for service businesses that have turned booking on — otherwise the
    // page would always be empty and the tools aren't advertised anyway.
    ...(showBookings
      ? [{ href: '/dashboard/appointments', label: 'Appointments', shortLabel: 'Bookings', icon: CalendarDays }]
      : []),
    { href: '/dashboard/analytics', label: 'Analytics', icon: ChartNoAxesColumn },
    ...(showBusiness ? [{ href: '/dashboard/business', label: 'My Business', shortLabel: 'Business', icon: Store }] : []),
    // Ordered daily-driver-first: whatever falls past MobileTabBar's 4-visible
    // cap collapses into its "More" menu, not off the nav entirely (docs/27
    // §7A D-08) — My Stock/Team/Billing are the ones expected to land there
    // for a tenant_admin, but nothing is actually unreachable any more. The
    // low-stock notification still deep-links straight into My Stock on
    // phones regardless of which tab it's currently under (docs/19 I1).
    ...(showBusiness ? [{ href: '/dashboard/inventory', label: 'My Stock', shortLabel: 'Stock', icon: Boxes }] : []),
    ...(showBusiness ? [{ href: '/dashboard/team', label: 'My Team', shortLabel: 'Team', icon: Users }] : []),
    ...(showBusiness ? [{ href: '/dashboard/billing', label: 'Billing', icon: CreditCard }] : []),
  ];
}

export function DashboardNav({ showBusiness, showBookings = false }: { showBusiness: boolean; showBookings?: boolean }) {
  return <SidebarNav items={buildItems(showBusiness, showBookings)} />;
}

/**
 * `MobileTabBar` shows the first four directly and collapses everything past
 * that into a "More" menu (docs/27 §7A D-08) — every item in `buildItems` is
 * reachable on a phone regardless of role/booking flags, never silently
 * dropped.
 */
export function DashboardTabBar({ showBusiness, showBookings = false }: { showBusiness: boolean; showBookings?: boolean }) {
  return <MobileTabBar items={buildItems(showBusiness, showBookings)} />;
}
