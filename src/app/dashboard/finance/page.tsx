import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { DollarSign, PiggyBank, Repeat, TrendingUp } from 'lucide-react';
import { getCallerContext, resolveActiveTenant } from '@/lib/auth/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { HomeIcon } from '@/components/home-icon';
import { getEcommerceMetrics, type DateRange } from '@/services/analytics';
import { buildProductMargins, listBusinessExpenses } from '@/services/finance';
import { FinancePanel } from './finance-panel';

const RANGE_OPTIONS = [
  { value: '7d', label: '7 days', days: 7 },
  { value: '30d', label: '30 days', days: 30 },
  { value: '90d', label: '90 days', days: 90 },
  { value: 'mtd', label: 'This month', days: null },
] as const;

function formatMoney(amount: number, currency: string | null): string {
  const code = currency && currency.length === 3 ? currency.toUpperCase() : null;
  if (code) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(
        amount,
      );
    } catch {
      // fall through
    }
  }
  return amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: rangeParam } = await searchParams;
  const selectedRange = RANGE_OPTIONS.find((r) => r.value === rangeParam) ?? RANGE_OPTIONS[1];

  const ctx = await getCallerContext();
  if (!ctx) redirect('/login');
  const cookieStore = await cookies();
  const activeTenantId = resolveActiveTenant(ctx, cookieStore.get('cn_active_tenant')?.value);
  if (!activeTenantId) redirect('/login');

  const activeMembership = ctx.memberships.find((m) => m.tenantId === activeTenantId);
  if (activeMembership?.role !== 'tenant_admin') redirect('/dashboard');

  // eslint-disable-next-line react-hooks/purity -- Server Component wall-clock cutoff
  const now = Date.now();
  const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).toISOString();
  const rangeTo = new Date(now);
  const rangeFrom =
    selectedRange.value === 'mtd'
      ? new Date(monthStart)
      : new Date(now - (selectedRange.days ?? 30) * 24 * 60 * 60 * 1000);
  const range: DateRange = { from: rangeFrom.toISOString(), to: rangeTo.toISOString() };

  const supabase = await createSupabaseServerClient();
  const [{ data: tenant }, ecommerce, expenses] = await Promise.all([
    supabase.from('tenants').select('business_name, default_currency, catalog_data').eq('id', activeTenantId).single(),
    getEcommerceMetrics(activeTenantId, range),
    listBusinessExpenses(activeTenantId, range),
  ]);

  const currency = ecommerce.primaryCurrency ?? tenant?.default_currency ?? null;
  const productMargins = buildProductMargins(tenant?.catalog_data ?? null);

  return (
    <div className="flex flex-col gap-6 p-4 lg:p-6">
      <PageHeader
        title="Finance & CRM"
        description={`True profit for ${tenant?.business_name ?? 'your business'} — revenue, stock cost, and expenses in one place.`}
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {RANGE_OPTIONS.map((r) => (
          <Link
            key={r.value}
            href={`/dashboard/finance?range=${r.value}`}
            className={`rounded-lg px-2.5 py-1 text-xs ring-1 transition-colors ${
              r.value === selectedRange.value
                ? 'bg-primary text-primary-foreground ring-primary'
                : 'bg-card text-foreground ring-foreground/10 hover:ring-foreground/20'
            }`}
          >
            {r.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="bg-[color-mix(in_oklch,var(--card),var(--primary)_6%)] ring-1 ring-primary/15">
          <CardContent className="flex items-center gap-3 p-4">
            <HomeIcon icon={TrendingUp} tone="success" />
            <div>
              <p className="text-sm text-muted-foreground">Net profit</p>
              <p className="text-2xl font-semibold tabular-nums">{formatMoney(ecommerce.netProfit, currency)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <HomeIcon icon={DollarSign} />
            <div>
              <p className="text-sm text-muted-foreground">Revenue (paid)</p>
              <p className="text-2xl font-semibold tabular-nums">{formatMoney(ecommerce.revenuePaid, currency)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <HomeIcon icon={PiggyBank} />
            <div>
              <p className="text-sm text-muted-foreground">COGS + expenses</p>
              <p className="text-2xl font-semibold tabular-nums">
                {formatMoney(ecommerce.cogs + ecommerce.operatingExpenses, currency)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <HomeIcon icon={Repeat} />
            <div>
              <p className="text-sm text-muted-foreground">Repeat buyers</p>
              <p className="text-2xl font-semibold tabular-nums">{ecommerce.repeatBuyers}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        Net profit = paid revenue − refunds − product cost (unit cost × qty sold) − logged expenses.
        {ecommerce.grossMarginPct !== null
          ? ` Gross margin before expenses: ${ecommerce.grossMarginPct.toFixed(0)}%.`
          : ' Add unit costs in My Stock to track COGS.'}
      </p>

      <FinancePanel
        tenantId={activeTenantId}
        expenses={expenses}
        productMargins={productMargins}
        currency={currency}
      />
    </div>
  );
}
