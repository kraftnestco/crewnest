import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCallerContext, resolveActiveTenant } from '@/lib/auth/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/page-header';
import { PAYWALL_PLANS } from '@/services/demo/plans';
import { providerForCountry } from '@/services/billing';
import { BillingPanel } from './billing-panel';

/**
 * Billing (docs/22-BILLING-STRIPE.md §4) — tenant-admin only, same gate as
 * Inventory: staff (tenant_agent) get inbox + orders only, never money screens.
 */
export default async function DashboardBillingPage() {
  const ctx = await getCallerContext(); // layout already gated; re-derive (React cache dedupes)
  if (!ctx) redirect('/login');
  const cookieStore = await cookies();
  const activeTenantId = resolveActiveTenant(ctx, cookieStore.get('cn_active_tenant')?.value);
  if (!activeTenantId) redirect('/dashboard');

  const activeMembership = ctx.memberships.find((m) => m.tenantId === activeTenantId);
  if (!ctx.isPlatformAdmin && activeMembership?.role !== 'tenant_admin') {
    redirect('/dashboard');
  }

  const supabase = await createSupabaseServerClient();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, business_name, plan, plan_status, billing_provider, billing_country, safepay_subscription_id')
    .eq('id', activeTenantId)
    .single();

  if (!tenant) redirect('/dashboard');

  // Provider decides both the displayed currency and how the tenant manages an
  // existing subscription (hosted portal vs. in-app cancel) — docs/25 §2.
  const provider = providerForCountry(tenant.billing_country);
  const billingProvider = tenant.billing_provider === 'safepay' || tenant.billing_provider === 'stripe'
    ? tenant.billing_provider
    : provider;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <PageHeader title="Billing" description="Manage your CrewNest plan and payment method." />
      <BillingPanel
        tenantId={tenant.id}
        currentPlan={tenant.plan}
        planStatus={tenant.plan_status}
        plans={PAYWALL_PLANS}
        billingProvider={billingProvider}
        hasSubscription={Boolean(tenant.safepay_subscription_id)}
      />
    </div>
  );
}
