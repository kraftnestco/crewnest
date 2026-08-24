'use client';

import { Check, ChevronsUpDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface ListSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface ListSelectGroup {
  /** Optional optgroup heading. Omit for a flat list. */
  label?: string;
  options: ListSelectOption[];
}

/**
 * Theme-aware single-select dropdown — the same `DropdownMenu` primitive the
 * `TenantSwitcher` ("business select drawer") uses, so it inherits the app's
 * dark/light tokens (`bg-popover`, `text-popover-foreground`, `focus:bg-accent`)
 * instead of the OS chrome a bare `<select>` paints, which ignored dark mode
 * and rendered light text on a light background.
 *
 * Supports optgroups via `groups[].label` (mirrors `<optgroup>`), so the
 * timezone picker's "Common" / "All timezones" split is preserved.
 */
export function ListSelect({
  value,
  onChange,
  groups,
  placeholder = 'Select…',
  triggerClassName,
  contentClassName,
  disabled,
  ariaLabel,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  groups: ListSelectGroup[];
  placeholder?: string;
  triggerClassName?: string;
  contentClassName?: string;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
}) {
  const flat = groups.flatMap((g) => g.options);
  const selected = flat.find((o) => o.value === value);
  const displayLabel = selected ? selected.label : placeholder;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        id={id}
        disabled={disabled}
        aria-label={ariaLabel ?? displayLabel}
        className={cn(
          // Matches the h-9 input look the wizard's native <select> used, so it
          // lines up with adjacent <Input> fields in the same card.
          'flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-popup-open:bg-accent data-popup-open:text-accent-foreground',
          triggerClassName,
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-muted-foreground')}>
          {displayLabel}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={cn('min-w-56', contentClassName)}
      >
        {groups.map((g, i) => (
          <DropdownMenuGroup key={i}>
            {g.label && <DropdownMenuLabel>{g.label}</DropdownMenuLabel>}
            {g.options.map((o) => (
              <DropdownMenuItem
                key={o.value}
                disabled={o.disabled}
                onClick={() => onChange(o.value)}
                className="gap-2 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.value === value && <Check className="size-3.5 shrink-0 text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
