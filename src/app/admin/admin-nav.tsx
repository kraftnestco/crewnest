'use client';

import { LayoutDashboard, Activity, Building2, MessagesSquare, Package, ChartNoAxesColumn, Settings, Sparkles } from 'lucide-react';
import { SidebarNav, MobileTabBar, type NavItem } from '@/components/app-nav';

/**
 * Agency-admin nav items (docs/19, Phase U2). One list drives both the desktop
 * sidebar and the mobile bottom tab bar. Overview is exact-match so it doesn't
 * stay lit on every /admin child route. Mobile caps at the first five
 * (`MobileTabBar` slices), so the review/setup surfaces (Copilot, Analytics,
 * Settings) sit last as the desktop-only tail (docs/20 §1.4/§2.4) — System
 * health remains the mobile triage surface.
 */
const NAV_ITEMS: NavItem[] = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/health', label: 'System health', shortLabel: 'Health', icon: Activity },
  { href: '/admin/clients', label: 'Clients', icon: Building2 },
  { href: '/admin/chat', label: 'Live Inbox', shortLabel: 'Inbox', icon: MessagesSquare },
  { href: '/admin/orders', label: 'Orders', icon: Package },
  { href: '/admin/copilot', label: 'Copilot', icon: Sparkles },
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
