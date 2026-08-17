'use client';

import {
  Activity,
  Building2,
  CalendarDays,
  ChartNoAxesColumn,
  LayoutDashboard,
  MessagesSquare,
  Package,
  Settings,
  Sparkles,
} from 'lucide-react';
import { SidebarNav, MobileTabBar, type NavItem } from '@/components/app-nav';

/**
 * Agency-admin nav items (docs/19, Phase U2). One list drives both the desktop
 * sidebar and the mobile bottom tab bar. Overview is exact-match so it doesn't
 * stay lit on every /admin child route. Ordered daily-driver-first: with 9
 * items here, `MobileTabBar` shows the first four (Overview/Health/Clients/
 * Live Inbox) directly and collapses the rest — Orders, Appointments, ClerkAI,
 * Analytics, Settings — into its "More" menu (docs/27 §7A D-08), never off
 * the nav entirely.
 */
const NAV_ITEMS: NavItem[] = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/health', label: 'System health', shortLabel: 'Health', icon: Activity },
  { href: '/admin/clients', label: 'Clients', icon: Building2 },
  { href: '/admin/chat', label: 'Live Inbox', shortLabel: 'Inbox', icon: MessagesSquare },
  { href: '/admin/orders', label: 'Orders', icon: Package },
  { href: '/admin/appointments', label: 'Appointments', shortLabel: 'Bookings', icon: CalendarDays },
  { href: '/admin/copilot', label: 'ClerkAI', icon: Sparkles },
  { href: '/admin/analytics', label: 'Analytics', icon: ChartNoAxesColumn },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];

export function AdminNav() {
  return <SidebarNav items={NAV_ITEMS} />;
}

/**
 * Mobile tabs cap at five — Settings (rare, setup-time) stays desktop-only
 * rather than crowding the bar.
 */
export function AdminTabBar() {
  return <MobileTabBar items={NAV_ITEMS} />;
}
