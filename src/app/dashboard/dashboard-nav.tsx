'use client';

import { House, MessagesSquare, Package, ChartNoAxesColumn, Store, Users } from 'lucide-react';
import { SidebarNav, MobileTabBar, type NavItem } from '@/components/app-nav';

/**
 * Client-dashboard nav items (docs/19, Phase U2). One list drives both the
 * desktop sidebar and the mobile bottom tab bar. Home is exact-match so it
 * doesn't stay lit on every child route.
 */
function buildItems(showBusiness: boolean): NavItem[] {
  return [
    { href: '/dashboard', label: 'Home', icon: House, exact: true },
    { href: '/dashboard/chat', label: 'My Inbox', shortLabel: 'Inbox', icon: MessagesSquare },
    { href: '/dashboard/orders', label: 'My Orders', shortLabel: 'Orders', icon: Package },
    { href: '/dashboard/analytics', label: 'Analytics', icon: ChartNoAxesColumn },
    ...(showBusiness ? [{ href: '/dashboard/business', label: 'My Business', shortLabel: 'Business', icon: Store }] : []),
    ...(showBusiness ? [{ href: '/dashboard/team', label: 'My Team', shortLabel: 'Team', icon: Users }] : []),
  ];
}

export function DashboardNav({ showBusiness }: { showBusiness: boolean }) {
  return <SidebarNav items={buildItems(showBusiness)} />;
}

/**
 * Mobile tabs cap at five, so for tenant admins the daily-driver set is
 * Home/Inbox/Orders/Analytics/Business — Team (rare, setup-time) stays
 * desktop-only rather than crowding the bar.
 */
export function DashboardTabBar({ showBusiness }: { showBusiness: boolean }) {
  return <MobileTabBar items={buildItems(showBusiness)} />;
}
