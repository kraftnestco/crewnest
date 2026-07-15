import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import type { Database } from '@/types/database';
import type { Platform, Tenant } from '@/types/domain';

/**
 * Tenant resolution for inbound routing. Uses the SERVICE client (RLS bypass)
 * because webhooks are unauthenticated — the tenant is derived from the event's
 * destination. See docs/01-ARCHITECTURE.md §4.
 */

type TenantRow = Database['public']['Tables']['tenants']['Row'];

function mapTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    businessName: row.business_name,
    slug: row.slug,
    metaPageId: row.meta_page_id,
    instagramId: row.instagram_id,
    whatsappPhoneNumberId: row.whatsapp_phone_number_id,
    systemPrompt: row.system_prompt,
    catalogData: row.catalog_data,
    llmProvider: row.llm_provider,
    llmModel: row.llm_model,
    openaiKeySecretId: row.openai_key_secret_id,
    metaTokenSecretId: row.meta_token_secret_id,
    whatsappTokenSecretId: row.whatsapp_token_secret_id,
    widgetPublicKey: row.widget_public_key,
    widgetAllowedOrigins: row.widget_allowed_origins,
    isActive: row.is_active,
  };
}

const DESTINATION_COLUMN = {
  whatsapp: 'whatsapp_phone_number_id',
  facebook: 'meta_page_id',
  instagram: 'instagram_id',
} as const satisfies Partial<Record<Platform, keyof TenantRow>>;

export async function resolveByDestination(
  platform: Platform,
  destinationId: string,
): Promise<Tenant | null> {
  const column = (DESTINATION_COLUMN as Partial<Record<Platform, keyof TenantRow>>)[platform];
  if (!column) return null;

  const client = createServiceClient();
  const { data, error } = await client
    .from('tenants')
    .select('*')
    .eq(column, destinationId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw error;
  return data ? mapTenant(data) : null;
}

export async function resolveByWidgetKey(widgetPublicKey: string): Promise<Tenant | null> {
  const client = createServiceClient();
  const { data, error } = await client
    .from('tenants')
    .select('*')
    .eq('widget_public_key', widgetPublicKey)
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw error;
  return data ? mapTenant(data) : null;
}

/** Load a tenant by id, regardless of active status. Used by the admin dashboard. */
export async function getById(tenantId: string): Promise<Tenant | null> {
  const client = createServiceClient();
  const { data, error } = await client.from('tenants').select('*').eq('id', tenantId).maybeSingle();

  if (error) throw error;
  return data ? mapTenant(data) : null;
}
