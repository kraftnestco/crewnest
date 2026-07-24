/**
 * Business Copilot — action proposals (docs/19 O5 extension). Distinct from
 * `CopilotPatch` (a profile-field edit): an action is an imperative operation
 * — invite a teammate, set/restock inventory — that calls an EXISTING,
 * already-auth-checked tenant server action rather than writing a `tenants`
 * column. Same propose/apply spine: the LLM only ever stages one of these
 * (see `copilotTools.ts`), the owner reviews it as a card, and
 * `applyCopilotActionAction` is the only thing that actually calls the
 * privileged action. `.strict()` per-branch schemas reject anything not on
 * this exact allowlist of three operations — there is no generic "run any
 * action" escape hatch.
 *
 * NOT `server-only`: the client panel imports `CopilotAction` + `describeCopilotAction`
 * to render the preview card, mirroring how it already imports `CopilotPatch`.
 */
import { z } from 'zod';
import { MEMBER_ROLE_VALUES } from '@/lib/constants';

export const copilotActionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('invite_team_member'),
      email: z.string().trim().email(),
      role: z.enum(MEMBER_ROLE_VALUES),
    })
    .strict(),
  z
    .object({
      type: z.literal('set_stock'),
      itemName: z.string().trim().min(1),
      stock: z.number().int().min(0).nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal('restock'),
      itemName: z.string().trim().min(1),
      addUnits: z.number().int().positive(),
    })
    .strict(),
]);

export type CopilotAction = z.infer<typeof copilotActionSchema>;

export interface ValidateActionResult {
  ok: true;
  action: CopilotAction;
}
export interface ValidateActionError {
  ok: false;
  error: string;
}

export function validateCopilotAction(raw: unknown): ValidateActionResult | ValidateActionError {
  const parsed = copilotActionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'That action was not valid.' };
  return { ok: true, action: parsed.data };
}

const ROLE_LABEL: Record<(typeof MEMBER_ROLE_VALUES)[number], string> = {
  tenant_admin: 'Admin (full access)',
  tenant_agent: 'Agent',
};

/** Human-readable review line for the proposed-action card. */
export function describeCopilotAction(action: CopilotAction): string {
  switch (action.type) {
    case 'invite_team_member':
      return `Invite ${action.email} to your team as ${ROLE_LABEL[action.role]}`;
    case 'set_stock':
      return action.stock === null
        ? `Stop tracking stock for "${action.itemName}"`
        : `Set stock for "${action.itemName}" to ${action.stock}`;
    case 'restock':
      return `Add ${action.addUnits} units to "${action.itemName}"'s stock`;
  }
}

export interface ApplyActionResult {
  success: boolean;
  error: string | null;
}
