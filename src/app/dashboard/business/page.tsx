import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Store } from 'lucide-react';
import { getCallerContext, resolveActiveTenant } from '@/lib/auth/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { IntakeForm } from '@/app/admin/clients/[id]/intake/intake-form';
import { PageHeader } from '@/components/page-header';
import { ChannelSetup } from './channel-setup';

export default async function DashboardBusinessPage() {
  const ctx = await getCallerContext(); // layout already gated; re-derive (React cache dedupes)
  if (!ctx) redirect('/login');
  const cookieStore = await cookies();
  const activeTenantId = resolveActiveTenant(ctx, cookieStore.get('cn_active_tenant')?.value);
  if (!activeTenantId) redirect('/dashboard');

  const activeMembership = ctx.memberships.find((m) => m.tenantId === activeTenantId);
  if (activeMembership?.role !== 'tenant_admin') {
    // Staff (tenant_agent) get inbox + orders only — no business editing (docs/13 §9).
    redirect('/dashboard');
  }

  const supabase = await createSupabaseServerClient();
  const { data: tenant } = await supabase
    .from('tenants')
    .select(
      'id, business_name, system_prompt, catalog_data, catalog_freeform_text, custom_orders_enabled, custom_orders_require_approval, custom_order_instructions, media_handling, business_type, booking_link, knowledge_base, business_hours, timezone, payments_enabled, payment_methods, payment_instructions, default_currency, prepaid_required, whatsapp_phone_number_id, meta_page_id, instagram_id, widget_public_key, requested_platforms, platform_setup_notes, platform_setup_requested_at',
    )
    .eq('id', activeTenantId)
    .single();

  if (!tenant) redirect('/dashboard');

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <PageHeader
        title="My Business"
        description={`Tell your AI assistant about ${tenant.business_name} and manage which channels it talks to customers on. Technical setup (API keys, tokens) is always handled by our team.`}
      />

      <ChannelSetup
        tenantId={activeTenantId}
        connections={{
          whatsapp: Boolean(tenant.whatsapp_phone_number_id),
          facebook: Boolean(tenant.meta_page_id),
          instagram: Boolean(tenant.instagram_id),
          web: Boolean(tenant.widget_public_key),
        }}
        requestedPlatforms={tenant.requested_platforms}
        platformSetupNotes={tenant.platform_setup_notes}
        platformSetupRequestedAt={tenant.platform_setup_requested_at}
      />

      <div className="border-t pt-8">
        <div className="mb-1 flex items-center gap-2">
          <Store className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-heading text-base font-semibold">Business details</h2>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          This is what your AI assistant uses to talk to customers — save any time and our team sees
          the update instantly.
        </p>
        <IntakeForm tenant={tenant} viewer="client" />
      </div>
    </div>
  );
}
