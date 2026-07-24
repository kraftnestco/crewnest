'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { assertTenantAccess, getCallerContext } from '@/lib/auth/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import * as tenants from '@/services/tenants';
import { ingestTenantKnowledge } from '@/services/knowledge';
import { parseCatalogueFreeform } from '@/services/ai/catalogueParser';
import { runCopilotTurn } from '@/services/ai/copilot/runCopilotTurn';
import { validatePatch, type ApplyPatchState, type CopilotMessage, type CopilotTurnState } from '@/services/ai/copilot/tiers';
import type { Database, Json } from '@/types/database';
import { log } from '@/lib/log';

/**
 * Business Copilot server actions (docs/19 O5). The safety spine is a strict
 * propose/apply split:
 *
 * - `copilotTurnAction` runs the LLM tool-calling loop, which is READ-ONLY w.r.t.
 *   tenant data — it only returns a STAGED patch (plus a usage_logs row). It never
 *   writes to `tenants`.
 * - `applyCopilotPatchAction` is the ONLY writer. It re-checks auth, hard-validates
 *   the patch against the allowlist (`validatePatch` rejects any off-limits key),
 *   and commits a PARTIAL update through the RLS-scoped authenticated client so
 *   untouched settings are never reset — the key difference from updateIntakeAction,
 *   which reads every field and would wipe unspecified ones.
 *
 * Both are gated exactly like the intake actions: caller must be a platform_admin
 * or a tenant_admin OF THIS TENANT. A jailbroken copilot can therefore only ever
 * touch the caller's own tenant profile, and only its allowlisted columns.
 */

type TenantUpdate = Database['public']['Tables']['tenants']['Update'];

/** Shared auth gate — mirrors generateSystemPromptAction in the intake actions. */
async function requireTenantAdmin(tenantId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getCallerContext();
  if (!ctx) return { ok: false, error: 'Unauthorized.' };
  try {
    assertTenantAccess(ctx, tenantId);
  } catch {
    return { ok: false, error: 'Forbidden: tenant not accessible.' };
  }
  if (!ctx.isPlatformAdmin && !ctx.memberships.some((m) => m.tenantId === tenantId && m.role === 'tenant_admin')) {
    return { ok: false, error: 'Forbidden: only a tenant admin may edit business settings.' };
  }
  return { ok: true };
}

/**
 * Run one copilot turn. Read-only w.r.t. tenant data (writes only usage_logs
 * inside runCopilotTurn), so nothing to revalidate. Returns a staged patch the
 * client previews; nothing is committed until `applyCopilotPatchAction`.
 */
export async function copilotTurnAction(
  tenantId: string,
  messages: CopilotMessage[],
): Promise<CopilotTurnState> {
  const gate = await requireTenantAdmin(tenantId);
  if (!gate.ok) return { reply: '', patch: {}, hasMoneyChange: false, error: gate.error };

  const tenant = await tenants.getById(tenantId);
  if (!tenant) return { reply: '', patch: {}, hasMoneyChange: false, error: 'Tenant not found.' };

  // The domain Tenant type doesn't carry catalog_freeform_text — read it (RLS-scoped)
  // so the copilot revises the owner's real catalogue text instead of wiping it.
  const supabase = await createSupabaseServerClient();
  const { data: extra } = await supabase
    .from('tenants')
    .select('catalog_freeform_text')
    .eq('id', tenantId)
    .maybeSingle();

  // Only accept the two roles the runner understands; ignore anything else the client sent.
  const clean = (messages ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  try {
    const result = await runCopilotTurn(tenant, extra?.catalog_freeform_text ?? null, clean);
    return { reply: result.reply, patch: result.patch, hasMoneyChange: result.hasMoneyChange, error: null };
  } catch (err) {
    log.error('[copilot] turn failed', { tenantId, err });
    return {
      reply: '',
      patch: {},
      hasMoneyChange: false,
      error: "Something went wrong preparing that change. Please try again, or rephrase it.",
    };
  }
}

/**
 * Commit a copilot-proposed patch. Deterministic and tier-checked: validates the
 * patch against the allowlist, then partial-updates only the changed columns.
 */
export async function applyCopilotPatchAction(tenantId: string, rawPatch: unknown): Promise<ApplyPatchState> {
  const gate = await requireTenantAdmin(tenantId);
  if (!gate.ok) return { success: false, error: gate.error };

  const validated = validatePatch(rawPatch);
  if (!validated.ok) return { success: false, error: validated.error };
  const patch = validated.patch;

  if (Object.keys(patch).length === 0) return { success: false, error: 'There were no changes to apply.' };

  const tenant = await tenants.getById(tenantId);
  if (!tenant) return { success: false, error: 'Tenant not found.' };

  const update: TenantUpdate = {};
  if (patch.system_prompt !== undefined) update.system_prompt = patch.system_prompt;
  if (patch.catalog_freeform_text !== undefined) {
    update.catalog_freeform_text = patch.catalog_freeform_text;
    // Derive the structured catalogue the AI actually reads — same as the client
    // intake path. Never let the model write raw catalog_data directly.
    try {
      update.catalog_data = await parseCatalogueFreeform(tenant, patch.catalog_freeform_text);
    } catch {
      return { success: false, error: "Couldn't process your catalogue text. Please try again." };
    }
  }
  if (patch.knowledge_base !== undefined) update.knowledge_base = patch.knowledge_base as Json;
  if (patch.business_hours !== undefined) update.business_hours = patch.business_hours as Json;
  if (patch.timezone !== undefined) update.timezone = patch.timezone;
  if (patch.business_type !== undefined) update.business_type = patch.business_type;
  if (patch.booking_link !== undefined) update.booking_link = patch.booking_link;
  if (patch.custom_orders_enabled !== undefined) update.custom_orders_enabled = patch.custom_orders_enabled;
  if (patch.custom_orders_require_approval !== undefined)
    update.custom_orders_require_approval = patch.custom_orders_require_approval;
  if (patch.custom_order_instructions !== undefined) update.custom_order_instructions = patch.custom_order_instructions;
  if (patch.media_handling !== undefined) update.media_handling = patch.media_handling;
  if (patch.voice_handling !== undefined) update.voice_handling = patch.voice_handling;
  if (patch.payments_enabled !== undefined) update.payments_enabled = patch.payments_enabled;
  if (patch.payment_methods !== undefined) update.payment_methods = patch.payment_methods;
  if (patch.payment_instructions !== undefined) update.payment_instructions = patch.payment_instructions;
  if (patch.default_currency !== undefined) update.default_currency = patch.default_currency;
  if (patch.prepaid_required !== undefined) update.prepaid_required = patch.prepaid_required;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('tenants').update(update).eq('id', tenantId);
  if (error) return { success: false, error: error.message };

  // Re-embed when the catalogue or knowledge changed (docs/12 §5.2). Refetch the
  // FRESH row so we ingest the actual committed values for both sources, whichever
  // one changed. Best-effort, post-response, logged not surfaced.
  if (patch.catalog_freeform_text !== undefined || patch.knowledge_base !== undefined) {
    after(async () => {
      const fresh = await tenants.getById(tenantId);
      if (!fresh) return;
      try {
        await ingestTenantKnowledge(fresh, fresh.catalogData, fresh.knowledgeBase);
      } catch (err) {
        log.error('[copilot] knowledge re-embed failed', { tenantId, err });
      }
    });
  }

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/business');
  revalidatePath('/admin/clients');
  revalidatePath(`/admin/clients/${tenantId}/intake`);
  return { success: true, error: null };
}
