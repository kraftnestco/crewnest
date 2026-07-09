import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import type { Platform, Tenant } from '@/types/domain';

/**
 * Tenant resolution for inbound routing. Uses the SERVICE client (RLS bypass)
 * because webhooks are unauthenticated — the tenant is derived from the event's
 * destination. See docs/01-ARCHITECTURE.md §4.
 *
 * TODO(sonnet): implement the queries and row→Tenant mapping against the
 * generated types (src/types/database.ts after `supabase gen types`). Keep the
 * mapping in one `mapTenant()` helper. Only return active tenants.
 */

export async function resolveByDestination(
  platform: Platform,
  destinationId: string,
): Promise<Tenant | null> {
  // Column by platform: whatsapp → whatsapp_phone_number_id; facebook → meta_page_id;
  // instagram → instagram_id. Filter is_active = true. Use maybeSingle().
  void createServiceClient();
  void platform;
  void destinationId;
  throw new Error('TODO(sonnet): implement resolveByDestination (see docs/08 §5.1)');
}

export async function resolveByWidgetKey(widgetPublicKey: string): Promise<Tenant | null> {
  void createServiceClient();
  void widgetPublicKey;
  throw new Error('TODO(sonnet): implement resolveByWidgetKey (see docs/08 §5.1)');
}
