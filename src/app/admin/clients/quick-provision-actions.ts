'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { getCallerContext } from '@/lib/auth/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import * as tenants from '@/services/tenants';
import { magicImportFromUrl } from '@/services/ai/magicImport';
import { parseCatalogueFreeform } from '@/services/ai/catalogueParser';
import { ingestTenantKnowledge } from '@/services/knowledge';
import { inviteMember } from '@/services/teamMembers';
import type { Database } from '@/types/database';
import type { QuickProvisionState } from './quick-provision-state';
import { log } from '@/lib/log';

/**
 * O4 — Agency one-form provisioning (docs/19 Track O). Collapses the old
 * create → intake → invite sequence into a SINGLE admin action: create the
 * tenant, optionally read its website to pre-fill persona/catalogue/knowledge
 * (Magic Import, reused), and optionally send the owner a login invite — so
 * onboarding a client is minutes, not sessions.
 *
 * Everything after the tenant row itself is best-effort: a failed import or
 * invite never rolls back the created client (it just surfaces as a warning),
 * because the admin can always finish the profile from the intake. Only the
 * `tenants` insert failing is fatal.
 */

type TenantUpdate = Database['public']['Tables']['tenants']['Update'];

function optionalString(value: FormDataEntryValue | null): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  return s.length > 0 ? s : null;
}

function fail(error: string): QuickProvisionState {
  return { error, success: false, widgetPublicKey: null, summary: null, warnings: [] };
}

export async function quickProvisionAction(
  _prev: QuickProvisionState,
  formData: FormData,
): Promise<QuickProvisionState> {
  const ctx = await getCallerContext();
  if (!ctx?.isPlatformAdmin) return fail('Forbidden.');

  const businessName = optionalString(formData.get('business_name'));
  if (!businessName) return fail('Business name is required.');

  const importUrl = optionalString(formData.get('import_url'));
  const clientEmail = optionalString(formData.get('client_email'))?.toLowerCase() ?? null;
  const slug = optionalString(formData.get('slug'));
  const whatsappPhoneNumberId = optionalString(formData.get('whatsapp_phone_number_id'));
  const allowedOriginsRaw = optionalString(formData.get('widget_allowed_origins'));

  const widgetAllowedOrigins = allowedOriginsRaw
    ? allowedOriginsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const widgetPublicKey = `pk_live_${randomBytes(16).toString('hex')}`;

  const supabase = await createSupabaseServerClient();
  const { data: created, error: insertError } = await supabase
    .from('tenants')
    .insert({
      business_name: businessName,
      slug,
      whatsapp_phone_number_id: whatsappPhoneNumberId,
      widget_public_key: widgetPublicKey,
      widget_allowed_origins: widgetAllowedOrigins,
    })
    // Select the AI-call inputs too (provider/model/BYOK ref) so we can run the
    // import/parse against the freshly created row without a second round-trip.
    .select('id, business_name, llm_provider, llm_model, openai_key_secret_id')
    .single();

  if (insertError || !created) {
    return fail(insertError?.message ?? 'Failed to create client.');
  }

  // The minimal identity the AI utilities need — never carries secrets/tokens.
  const aiTenant = {
    id: created.id,
    businessName: created.business_name,
    openaiKeySecretId: created.openai_key_secret_id,
    llmProvider: created.llm_provider,
    llmModel: created.llm_model,
  };

  const warnings: string[] = [];
  const summaryParts: string[] = [];
  let embedNeeded = false;

  // ── Magic Import (optional) — read the site, pre-fill the profile ──────────
  if (importUrl) {
    try {
      const { fields, summary } = await magicImportFromUrl(aiTenant, importUrl);
      const update: TenantUpdate = {
        system_prompt: fields.system_prompt,
        business_type: fields.business_type,
      };
      if (fields.catalog_freeform_text) {
        update.catalog_freeform_text = fields.catalog_freeform_text;
        try {
          update.catalog_data = await parseCatalogueFreeform(aiTenant, fields.catalog_freeform_text);
        } catch (err) {
          log.error('[quick-provision] catalogue parse failed', { tenantId: created.id, err });
        }
      }
      if (fields.knowledge_base) update.knowledge_base = fields.knowledge_base;

      const { error: updErr } = await supabase.from('tenants').update(update).eq('id', created.id);
      if (updErr) {
        warnings.push("Imported the site but couldn't save every field. Check the intake.");
        log.error('[quick-provision] import update failed', { tenantId: created.id, error: updErr.message });
      } else {
        embedNeeded = Boolean(update.catalog_freeform_text || update.knowledge_base);
        summaryParts.push(summary);
      }
    } catch (err) {
      warnings.push(
        `Couldn't import from that link (${err instanceof Error ? err.message : 'unknown error'}). The client was still created. Fill in their profile from the intake.`,
      );
      log.error('[quick-provision] magic import failed', { tenantId: created.id, err });
    }
  }

  // ── Client login invite (optional) ────────────────────────────────────────
  if (clientEmail) {
    try {
      const result = await inviteMember(created.id, clientEmail, 'tenant_admin');
      if (result.success) {
        summaryParts.push(
          result.alreadyRegistered
            ? `${clientEmail} already had a login and is now linked to this client.`
            : `Login invite sent to ${clientEmail}.`,
        );
      } else {
        warnings.push(`Couldn't invite ${clientEmail}: ${result.error ?? 'invite failed'}.`);
      }
    } catch (err) {
      warnings.push(`Couldn't invite ${clientEmail}: ${err instanceof Error ? err.message : 'unknown error'}.`);
      log.error('[quick-provision] invite failed', { tenantId: created.id, err });
    }
  }

  // Re-embed knowledge post-response when the import populated catalogue/KB
  // (docs/12 §5.2) — same best-effort after() path as the intake save.
  if (embedNeeded) {
    after(async () => {
      const fresh = await tenants.getById(created.id);
      if (!fresh) return;
      try {
        await ingestTenantKnowledge(fresh, fresh.catalogData, fresh.knowledgeBase);
      } catch (err) {
        log.error('[quick-provision] knowledge embed failed', { tenantId: created.id, err });
      }
    });
  }

  revalidatePath('/admin/clients');

  const summary = summaryParts.length
    ? summaryParts.join(' ')
    : 'Client created. Add their profile from the intake, or share the widget key below.';

  return { error: null, success: true, widgetPublicKey, summary, warnings };
}
