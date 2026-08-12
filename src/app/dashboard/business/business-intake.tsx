'use client';

import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { IntakeWizard } from '@/components/intake/intake-wizard';
import { IntakeSummary } from '@/components/intake/intake-summary';
import { MagicImport } from '@/components/intake/magic-import';
import type { IntakeTenant, MagicImportFields } from '@/components/intake/intake-shared';
import {
  generateSystemPromptAction,
  importFromUrlAction,
  updateIntakeAction,
} from '@/app/admin/clients/[id]/intake/actions';
import { initialUpdateIntakeState } from '@/app/admin/clients/[id]/intake/intake-state';

/**
 * Dashboard wrapper around the shared `IntakeWizard` (docs: "try it for your
 * business" plan, Phase A). Shows the step wizard until the tenant has
 * completed it once (`intake_completed_at`), then a read-only summary with an
 * Edit button that reopens the wizard pre-filled.
 *
 * Magic Import (docs/19 O2) sits above the wizard: pasting a link overlays a
 * draft onto the tenant prop and remounts the wizard (via `key`) so its
 * mount-time initializers pick up the imported values. Nothing persists until
 * the owner completes the existing Save.
 */
export function BusinessIntake({ tenant }: { tenant: IntakeTenant & { intake_completed_at: string | null } }) {
  const [editing, setEditing] = useState(!tenant.intake_completed_at);
  const boundAction = updateIntakeAction.bind(null, tenant.id);
  const [state, formAction, isPending] = useActionState(boundAction, initialUpdateIntakeState);
  const [handledState, setHandledState] = useState(state);

  const [draft, setDraft] = useState<MagicImportFields | null>(null);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [importNonce, setImportNonce] = useState(0);

  if (state !== handledState) {
    setHandledState(state);
    if (state.success) setEditing(false);
  }

  useEffect(() => {
    if (state.success) {
      toast.success('Business details saved.');
    }
  }, [state]);

  if (!editing) {
    return <IntakeSummary tenant={tenant} onEdit={() => setEditing(true)} />;
  }

  const mergedTenant: IntakeTenant & { intake_completed_at: string | null } = draft
    ? {
        ...tenant,
        ...(draft.business_type !== undefined ? { business_type: draft.business_type } : {}),
        ...(draft.system_prompt !== undefined ? { system_prompt: draft.system_prompt } : {}),
        ...(draft.catalog_freeform_text !== undefined ? { catalog_freeform_text: draft.catalog_freeform_text } : {}),
        ...(draft.knowledge_base !== undefined ? { knowledge_base: draft.knowledge_base } : {}),
      }
    : tenant;

  return (
    <div className="space-y-4">
      <MagicImport
        action={importFromUrlAction.bind(null, tenant.id)}
        onImported={(fields, summary) => {
          setDraft(fields);
          setImportSummary(summary);
          setImportNonce((n) => n + 1);
        }}
      />
      {importSummary && (
        <div className="rounded-lg border border-primary/30 bg-[color-mix(in_oklch,var(--card),var(--primary)_6%)] px-3 py-2 text-sm text-foreground">
          {importSummary}
        </div>
      )}
      <IntakeWizard
        key={`intake-${importNonce}`}
        tenant={mergedTenant}
        onFinish={formAction}
        isSubmitting={isPending}
        submitError={state.error}
        finishLabel="Save business details"
        onGeneratePrompt={generateSystemPromptAction.bind(null, tenant.id)}
      />
    </div>
  );
}
