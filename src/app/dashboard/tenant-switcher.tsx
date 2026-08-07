'use client';

import { Check, ChevronsUpDown } from 'lucide-react';
import { useTransition } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
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
 * Desktop sidebar switcher. A plain <select> is right here: it sits inside the
 * always-visible sidebar, where the current business is already labelled above it.
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
  const [isPending, startTransition] = useTransition();

  if (tenants.length <= 1) {
    return (
      <span className="max-w-[8rem] truncate rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-medium text-foreground">
        {activeTenantName}
      </span>
    );
  }

  function handleSelect(tenantId: string) {
    if (tenantId === activeTenantId) return;
    const formData = new FormData();
    formData.set('tenant_id', tenantId);
    // The action redirects to /dashboard, which re-renders the whole shell with
    // the newly-active tenant — no local state to keep in sync here.
    startTransition(() => {
      void setActiveTenantAction(formData);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={isPending}
        aria-label={`Active business: ${activeTenantName}. Switch business`}
        className="flex min-w-0 items-center gap-1 rounded-full bg-muted px-2 py-1 text-[0.65rem] font-medium text-foreground transition-opacity disabled:opacity-60"
      >
        {/* Grows with the space the topbar actually has rather than a fixed
            7rem cap, which truncated even short business names to "Kraf…". */}
        <span className="min-w-0 truncate">{activeTenantName}</span>
        <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
