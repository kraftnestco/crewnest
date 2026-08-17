'use client';

import { Check, ChevronsUpDown } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { setActiveTenantAction } from './actions';

export interface SwitchableTenant {
  tenantId: string;
  name: string;
}

/** Eyebrow + name, shared by the switcher trigger and its static twin. */
function TenantIdentity({ name }: { name: string }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block text-[0.6rem] font-medium tracking-wide text-muted-foreground uppercase">
        Business
      </span>
      <span className="block truncate text-sm leading-tight font-medium">{name}</span>
    </span>
  );
}

const ROW = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ring-1 ring-sidebar-border';

/**
 * Submits through a real <form> rather than calling the action directly.
 *
 * `setActiveTenantAction` ends in `redirect()`, and Next implements that by
 * THROWING a NEXT_REDIRECT signal. Calling the action imperatively (and
 * discarding its promise with `void`) left that throw unhandled, so instead of
 * navigating, the app tripped its global error boundary — the literal
 * "Something went wrong" screen. A form submission lets React own the call, so
 * it recognises the redirect signal and performs the navigation.
 */
function useTenantSelect(activeTenantId: string | undefined) {
  // Set on submit so the trigger disables immediately; the navigation that
  // follows unmounts the component, so it never needs resetting.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function select(tenantId: string) {
    if (tenantId === activeTenantId) return;
    const form = formRef.current;
    if (!form) return;
    const input = form.elements.namedItem('tenant_id') as HTMLInputElement | null;
    if (!input) return;
    input.value = tenantId;
    setIsSubmitting(true);
    form.requestSubmit();
  }

  const hiddenForm = (
    <form ref={formRef} action={setActiveTenantAction} className="hidden">
      <input type="hidden" name="tenant_id" defaultValue={activeTenantId ?? ''} />
    </form>
  );

  return { hiddenForm, select, isSubmitting };
}

/**
 * The menu body — one row per business, current one ticked.
 *
 * The label MUST be inside a Group. DropdownMenuLabel renders Base UI's
 * Menu.GroupLabel, which reads MenuGroupContext and THROWS when it isn't under
 * a <Menu.Group> ("MenuGroupContext is missing"). A bare label therefore
 * crashed the moment the menu opened, before any business was picked.
 */
function TenantMenuItems({
  tenants,
  activeTenantId,
  onSelect,
}: {
  tenants: SwitchableTenant[];
  activeTenantId: string | undefined;
  onSelect: (tenantId: string) => void;
}) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>Switch business</DropdownMenuLabel>
      {tenants.map((t) => (
        <DropdownMenuItem
          key={t.tenantId}
          onClick={() => onSelect(t.tenantId)}
          className="gap-2 py-1.5"
        >
          <span className="min-w-0 flex-1 truncate">{t.name}</span>
          {t.tenantId === activeTenantId && <Check className="size-3.5 shrink-0 text-primary" />}
        </DropdownMenuItem>
      ))}
    </DropdownMenuGroup>
  );
}

/**
 * Desktop sidebar switcher.
 *
 * Was a bare `<select>`, which the browser paints with its own OS control
 * chrome — it ignored the sidebar's type scale, radii and hover states, so it
 * read as an unstyled form field bolted onto the shell. This is the same
 * dropdown primitive the rest of the app uses, which also lets the closed
 * state carry an eyebrow label instead of just raw text.
 *
 * Only rendered when there's more than one business to switch between;
 * single-tenant members get <TenantBadge/> instead.
 */
export function TenantSwitcher({
  tenants,
  activeTenantId,
}: {
  tenants: SwitchableTenant[];
  activeTenantId: string | undefined;
}) {
  const { hiddenForm, select, isSubmitting } = useTenantSelect(activeTenantId);
  const activeName = tenants.find((t) => t.tenantId === activeTenantId)?.name ?? 'Select a business';

  return (
    <div className="px-3 pb-3">
      {hiddenForm}
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={isSubmitting}
          aria-label={`Active business: ${activeName}. Switch business`}
          className={cn(
            ROW,
            'bg-card transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground',
          )}
        >
          <TenantIdentity name={activeName} />
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          <TenantMenuItems tenants={tenants} activeTenantId={activeTenantId} onSelect={select} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * Non-interactive twin of the switcher, for a member of exactly one business —
 * same card so the sidebar looks identical either way, minus the affordance
 * that would open a one-item menu.
 */
export function TenantBadge({ name }: { name: string }) {
  return (
    <div className="px-3 pb-3">
      <div className={cn(ROW, 'bg-card')}>
        <TenantIdentity name={name} />
      </div>
    </div>
  );
}

/**
 * Mobile business switcher, rendered in the topbar.
 *
 * The sidebar that hosts the desktop switcher is `hidden lg:flex`, so on a phone
 * a member of several businesses had NO way to change which one they were
 * looking at — and the topbar badge showed the active business name without
 * hinting it was switchable. This makes that badge the control itself.
 *
 * Falls back to a plain non-interactive chip for a single-tenant member, so
 * there's never a dropdown affordance that opens a one-item menu.
 */
export function MobileTenantSwitcher({
  tenants,
  activeTenantId,
  activeTenantName,
}: {
  tenants: SwitchableTenant[];
  activeTenantId: string | undefined;
  activeTenantName: string;
}) {
  const { hiddenForm, select, isSubmitting } = useTenantSelect(activeTenantId);

  const chip =
    'flex min-w-0 items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-xs font-medium ring-1 ring-border';

  if (tenants.length <= 1) {
    return (
      <span className={cn(chip, 'max-w-[9rem]')}>
        <span className="truncate">{activeTenantName}</span>
      </span>
    );
  }

  return (
    <DropdownMenu>
      {hiddenForm}
      <DropdownMenuTrigger
        disabled={isSubmitting}
        aria-label={`Active business: ${activeTenantName}. Switch business`}
        className={cn(
          chip,
          'transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 data-popup-open:bg-accent',
        )}
      >
        {/* Grows with the space the topbar actually has rather than a fixed
            7rem cap, which truncated even short business names to "Kraf…". */}
        <span className="min-w-0 truncate">{activeTenantName}</span>
        <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <TenantMenuItems tenants={tenants} activeTenantId={activeTenantId} onSelect={select} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
