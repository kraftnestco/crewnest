'use client';

import Link from 'next/link';
import { LogOut, User } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { signOutAction } from '@/app/admin/actions';

function initials(fullName: string | null, email: string | null): string {
  const source = fullName?.trim() || email?.trim() || '';
  if (!source) return '?';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function AccountMenu({
  fullName,
  email,
  accountHref,
}: {
  fullName: string | null;
  email: string | null;
  accountHref: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground ring-1 ring-foreground/10 transition-opacity hover:opacity-90"
        aria-label="Account menu"
      >
        {initials(fullName, email)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/* A plain div, NOT DropdownMenuLabel: that renders Base UI's
            Menu.GroupLabel, which throws unless it's inside a Menu.Group /
            Menu.RadioGroup. This block is an identity header, not a label for a
            group of items, so there's no group to put it in. */}
        <div className="flex flex-col gap-0.5 px-1.5 py-1.5">
          <span className="truncate text-sm font-medium text-foreground">{fullName || 'Account'}</span>
          {email && <span className="truncate text-xs text-muted-foreground">{email}</span>}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href={accountHref} />}>
          <User />
          Account
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/*
          Submitted as a form, not `void signOutAction()`. The action ends in
          `redirect()`, which Next implements by THROWING a NEXT_REDIRECT
          signal — calling it imperatively and discarding the promise left that
          throw unhandled, so signing out tripped the global error boundary
          ("Something went wrong") instead of navigating. Letting React own the
          call means it recognises the signal and performs the navigation.
          Same bug, same fix as the mobile business switcher.
        */}
        <form action={signOutAction}>
          {/* `nativeButton` tells Base UI the rendered element really is a
              <button> (MenuItem renders a <div> by default), so it doesn't add
              the synthetic button semantics/keyboard handling a real one
              already has — and Enter/Space submit the form natively. */}
          <DropdownMenuItem
            variant="destructive"
            render={<button type="submit" />}
            nativeButton
            className="w-full"
          >
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
