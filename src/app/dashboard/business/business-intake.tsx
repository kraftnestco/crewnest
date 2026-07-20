'use client';

import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { IntakeWizard } from '@/components/intake/intake-wizard';
import { IntakeSummary } from '@/components/intake/intake-summary';
import type { IntakeTenant } from '@/components/intake/intake-shared';
import { updateIntakeAction } from '@/app/admin/clients/[id]/intake/actions';
import { initialUpdateIntakeState } from '@/app/admin/clients/[id]/intake/intake-state';

/**
 * Dashboard wrapper around the shared `IntakeWizard` (docs: "try it for your
 * business" plan, Phase A). Shows the step wizard until the tenant has
 * completed it once (`intake_completed_at`), then a read-only summary with an
 * Edit button that reopens the wizard pre-filled.
 */
export function BusinessIntake({ tenant }: { tenant: IntakeTenant & { intake_completed_at: string | null } }) {
  const [editing, setEditing] = useState(!tenant.intake_completed_at);
  const boundAction = updateIntakeAction.bind(null, tenant.id);
  const [state, formAction, isPending] = useActionState(boundAction, initialUpdateIntakeState);

  useEffect(() => {
    if (state.success) {
      toast.success('Business details saved.');
      setEditing(false);
    }
  }, [state]);

  if (!editing) {
    return <IntakeSummary tenant={tenant} onEdit={() => setEditing(true)} />;
  }

  return (
    <IntakeWizard
      tenant={tenant}
      onFinish={formAction}
      isSubmitting={isPending}
      submitError={state.error}
      finishLabel="Save business details"
    />
  );
}
