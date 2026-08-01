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
        <DropdownMenuItem variant="destructive" onClick={() => void signOutAction()}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
