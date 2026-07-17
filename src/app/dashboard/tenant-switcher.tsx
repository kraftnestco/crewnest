'use client';

import { setActiveTenantAction } from './actions';

export function TenantSwitcher({
  tenants,
  activeTenantId,
}: {
  tenants: { tenantId: string; name: string }[];
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
