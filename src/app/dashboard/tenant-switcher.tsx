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
import { setActiveTenantAction } from './actions';

export interface SwitchableTenant {
  tenantId: string;
  name: string;
}

/**
 * Desktop sidebar switcher. A plain <select> is right here: its closed state
 * already shows the active business as text, so there's no separate label
 * needed above it (only rendered when there's more than one business to
 * switch between — single-tenant members get that plain label instead).
 */
export function TenantSwitcher({
  tenants,
  activeTenantId,
}: {
  tenants: SwitchableTenant[];
  activeTenantId: string | undefined;
}) {
  return (
    <form action={setActiveTenantAction} className="px-3 pb-2">
      <select
        name="tenant_id"
        aria-label="Active business"
        defaultValue={activeTenantId}
        className="w-full rounded-md border border-sidebar-border bg-sidebar px-2 py-1.5 text-xs"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {tenants.map((t) => (
          <option key={t.tenantId} value={t.tenantId}>
            {t.name}
          </option>
        ))}
      </select>
    </form>
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
 * Falls back to a plain non-interactive badge for a single-tenant member, so
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
  // Set on submit so the trigger disables immediately; the navigation that
  // follows unmounts this component, so it never needs resetting.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  if (tenants.length <= 1) {
    return (
      <span className="max-w-[8rem] truncate rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-medium text-foreground">
        {activeTenantName}
      </span>
    );
  }

  /**
   * Submits through a real <form> rather than calling the action directly.
   *
   * `setActiveTenantAction` ends in `redirect()`, and Next implements that by
   * THROWING a NEXT_REDIRECT signal. Calling the action imperatively (and
   * discarding its promise with `void`) left that throw unhandled, so instead
   * of navigating, the app tripped its global error boundary — the literal
   * "Something went wrong" screen. A form submission lets React own the call,
   * so it recognises the redirect signal and performs the navigation.
   */
  function handleSelect(tenantId: string) {
    if (tenantId === activeTenantId) return;
    const form = formRef.current;
    if (!form) return;
    const input = form.elements.namedItem('tenant_id') as HTMLInputElement | null;
    if (!input) return;
    input.value = tenantId;
    setIsSubmitting(true);
    form.requestSubmit();
  }

  return (
    <DropdownMenu>
      <form ref={formRef} action={setActiveTenantAction} className="hidden">
        <input type="hidden" name="tenant_id" defaultValue={activeTenantId ?? ''} />
      </form>
      <DropdownMenuTrigger
        disabled={isSubmitting}
        aria-label={`Active business: ${activeTenantName}. Switch business`}
        className="flex min-w-0 items-center gap-1 rounded-full bg-muted px-2 py-1 text-[0.65rem] font-medium text-foreground transition-opacity disabled:opacity-60"
      >
        {/* Grows with the space the topbar actually has rather than a fixed
            7rem cap, which truncated even short business names to "Kraf…". */}
        <span className="min-w-0 truncate">{activeTenantName}</span>
        <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        {/*
          The label MUST be inside a Group. DropdownMenuLabel renders Base UI's
          Menu.GroupLabel, which reads MenuGroupContext and THROWS when it isn't
          under a <Menu.Group> ("MenuGroupContext is missing"). A bare label
          therefore crashed the moment the menu opened — before any business was
          picked — which is what put "Something went wrong" on screen.
        */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Switch business</DropdownMenuLabel>
          {tenants.map((t) => (
            <DropdownMenuItem
              key={t.tenantId}
              onClick={() => handleSelect(t.tenantId)}
              className="flex items-center justify-between gap-2"
            >
              <span className="truncate">{t.name}</span>
              {t.tenantId === activeTenantId && <Check className="h-3.5 w-3.5 shrink-0" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
