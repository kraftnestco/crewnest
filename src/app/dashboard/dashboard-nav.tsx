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
    // Inventory + Team sit past the mobile five-tab cap on purpose — both are
    // tenant-admin management pages, not daily drivers; the low-stock
    // notification deep-links straight into Inventory on phones (docs/19 I1).
    ...(showBusiness ? [{ href: '/dashboard/inventory', label: 'Inventory', shortLabel: 'Stock', icon: Boxes }] : []),
    ...(showBusiness ? [{ href: '/dashboard/team', label: 'My Team', shortLabel: 'Team', icon: Users }] : []),
    ...(showBusiness ? [{ href: '/dashboard/billing', label: 'Billing', icon: CreditCard }] : []),
  ];
}

export function DashboardNav({ showBusiness, showBookings = false }: { showBusiness: boolean; showBookings?: boolean }) {
  return <SidebarNav items={buildItems(showBusiness, showBookings)} />;
}

/**
 * Mobile tabs cap at five, so for tenant admins the daily-driver set is
 * Home/Inbox/Orders/Analytics/Business — Team (rare, setup-time) stays
 * desktop-only rather than crowding the bar.
 */
export function DashboardTabBar({ showBusiness, showBookings = false }: { showBusiness: boolean; showBookings?: boolean }) {
  return <MobileTabBar items={buildItems(showBusiness, showBookings)} />;
}
