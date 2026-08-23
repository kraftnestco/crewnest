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
    instagramTokenSecretId: row.instagram_token_secret_id,
    widgetPublicKey: row.widget_public_key,
    widgetAllowedOrigins: row.widget_allowed_origins,
    isActive: row.is_active,
    ordersEnabled: row.orders_enabled,
    ownerNotifyWhatsapp: row.owner_notify_whatsapp,
    ownerNotifyTemplate: row.owner_notify_template,
    customOrdersEnabled: row.custom_orders_enabled,
    customOrdersRequireApproval: row.custom_orders_require_approval,
    customOrderInstructions: row.custom_order_instructions,
    mediaHandling: (row.media_handling as Tenant['mediaHandling']) ?? 'match_catalogue',
    voiceHandling: (row.voice_handling as Tenant['voiceHandling']) ?? 'human_review',
    businessType: (row.business_type as Tenant['businessType']) ?? 'product',
    bookingLink: row.booking_link,
    bookingEnabled: row.booking_enabled ?? false,
    bookingMode: (row.booking_mode as Tenant['bookingMode']) ?? null,
    bookingOwnLink: row.booking_own_link,
    bookingDurationMinutes: row.booking_duration_minutes ?? 30,
    bookingLeadTimeMinutes: row.booking_lead_time_minutes ?? 120,
    bookingMaxDaysAhead: row.booking_max_days_ahead ?? 30,
    knowledgeBase: row.knowledge_base,
    businessHours: row.business_hours,
    timezone: row.timezone,
    paymentsEnabled: row.payments_enabled,
    paymentMethods: (row.payment_methods as Tenant['paymentMethods']) ?? ['cod'],
    paymentInstructions: row.payment_instructions,
    paymentProvider: row.payment_provider,
    paymentKeySecretId: row.payment_key_secret_id,
    defaultCurrency: row.default_currency,
    prepaidRequired: row.prepaid_required,
    plan: row.plan,
    planStatus: row.plan_status,
    csatPromptEnabled: row.csat_prompt_enabled,
    dailyCostAlertUsd: row.daily_cost_alert_usd,
    freeMonthlyCapUsd: row.free_monthly_cap_usd,
    messageRetentionDays: row.message_retention_days,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    billingProvider: (row.billing_provider === 'safepay' ? 'safepay' : 'stripe'),
    billingCountry: row.billing_country,
    safepayCustomerId: row.safepay_customer_id,
    safepaySubscriptionId: row.safepay_subscription_id,
    safepayAmountMinor: row.safepay_amount_minor,
    safepayCurrency: row.safepay_currency,
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

/**
 * Set (or clear, with null) `plan_status` — an app-validated marker, not a DB enum
 * (same free-text convention as `business_type`/`media_handling`). Used today for
 * `'pending_upgrade'` (signup) and `'cap_reached'` (docs/18 §3, Stage U-cap).
 * Read-then-compare-then-write, like `sessions.setAlertSignal`, so the caller can
 * notify only on a real transition rather than every blocked turn.
 */
export async function setPlanStatus(tenantId: string, value: string | null): Promise<boolean> {
  const client = createServiceClient();

  const { data: current, error: readError } = await client
    .from('tenants')
    .select('plan_status')
    .eq('id', tenantId)
    .single();
  if (readError) throw readError;

  const changed = current.plan_status !== value;

  const { error } = await client.from('tenants').update({ plan_status: value }).eq('id', tenantId);
  if (error) throw error;

  return changed;
}
