import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { PlatformBadge, type PlatformId } from '@/app/_landing/platform-icons';
import { getCallerContext, resolveActiveTenant } from '@/lib/auth/context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/page-header';
import { AnalyticsInfoDialog } from '@/components/analytics-info-dialog';
import { getVolume, getDeflection, getSentimentHealth, getCsat, getCommerceMetrics, getPlatformBreakdown, getEcommerceMetrics } from '@/services/analytics';
import type { DateRange, SentimentBucket } from '@/services/analytics';

/**
 * docs/16-ANALYTICS-AND-PROOF.md §5 — the client-facing value teaser (expands
 * docs/14 §6's home-page teaser into its own page). Deliberately excludes cost
 * and the per-tenant table — those are agency-only (unit economics is not the
 * client's business). Same server-rendered, `?range=` link pattern as
 * app/admin/analytics/page.tsx.
 */

const RANGE_OPTIONS = [
  { value: '7d', label: '7 days', days: 7 },
  { value: '30d', label: '30 days', days: 30 },
  { value: '90d', label: '90 days', days: 90 },
] as const;

const SENTIMENT_LABELS: Record<SentimentBucket, string> = {
  frustrated: 'Frustrated',
  price_objection: 'Price objection',
  product_doubt: 'Product doubt',
  cancellation_risk: 'Cancellation risk',
  clear: 'Clear',
};

const SENTIMENT_COLORS: Record<SentimentBucket, string> = {
  frustrated: 'bg-red-500',
  price_objection: 'bg-amber-500',
  product_doubt: 'bg-orange-500',
  cancellation_risk: 'bg-purple-500',
  clear: 'bg-emerald-500',
};
const PLATFORM_BADGE: Record<string, PlatformId> = {
  whatsapp: 'whatsapp',
  facebook: 'messenger',
  instagram: 'instagram',
  web: 'web',
};
const PLATFORM_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  facebook: 'Messenger',
  instagram: 'Instagram',
  web: 'Website chat',
};

function formatPercent(rate: number | null): string {
  return rate === null ? 'No data' : `${(rate * 100).toFixed(1)}%`;
}

function formatMoney(amount: number, currency: string | null): string {
  const code = currency && currency.length === 3 ? currency.toUpperCase() : null;
  if (code) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(amount);
    } catch {
      // fall through
    }
  }
  return amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default async function DashboardAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: rangeParam } = await searchParams;
  const selectedRange = RANGE_OPTIONS.find((r) => r.value === rangeParam) ?? RANGE_OPTIONS[1];

  const ctx = await getCallerContext(); // layout already gated; re-derive (React cache dedupes)
  if (!ctx) redirect('/login');
  const cookieStore = await cookies();
  const activeTenantId = resolveActiveTenant(ctx, cookieStore.get('cn_active_tenant')?.value);
  if (!activeTenantId) redirect('/dashboard');

  const to = new Date();
  const from = new Date(to.getTime() - selectedRange.days * 24 * 60 * 60 * 1000);
  const range: DateRange = { from: from.toISOString(), to: to.toISOString() };

  const [volume, deflection, sentiment, csat, commerce, platformBreakdown, ecommerce] = await Promise.all([
    getVolume(activeTenantId, range),
    getDeflection(activeTenantId, range),
    getSentimentHealth(activeTenantId, range),
    getCsat(activeTenantId, range),
    getCommerceMetrics(activeTenantId, range),
    getPlatformBreakdown(activeTenantId, range),
    getEcommerceMetrics(activeTenantId, range),
  ]);

  const money = ecommerce.primaryCurrency;

  const headlineCards = [
    {
      label: 'Revenue earned',
      value: formatMoney(ecommerce.revenuePaid, money),
      tone: 'bg-primary/20 ring-primary/35',
    },
    {
      label: 'Net profit',
      value: formatMoney(ecommerce.netProfit, money),
      tone: 'bg-emerald-500/20 ring-emerald-500/35 dark:bg-emerald-400/20 dark:ring-emerald-400/35',
    },
    {
      label: 'COGS',
      value: formatMoney(ecommerce.cogs, money),
      tone: 'bg-rose-500/20 ring-rose-500/35 dark:bg-rose-400/20 dark:ring-rose-400/35',
    },
    {
      label: 'Expenses',
      value: formatMoney(ecommerce.operatingExpenses, money),
      tone: 'bg-orange-500/20 ring-orange-500/35 dark:bg-orange-400/20 dark:ring-orange-400/35',
    },
    {
      label: 'Avg order value',
      value: ecommerce.averageOrderValue === null ? '—' : formatMoney(ecommerce.averageOrderValue, money),
      tone: 'bg-sky-500/20 ring-sky-500/35 dark:bg-sky-400/20 dark:ring-sky-400/35',
    },
    {
      label: 'Gross sales',
      value: formatMoney(ecommerce.grossSales, money),
      tone: 'bg-violet-500/20 ring-violet-500/35 dark:bg-violet-400/20 dark:ring-violet-400/35',
    },
    {
      label: 'Awaiting payment',
      value: formatMoney(ecommerce.pendingPaymentAmount, money),
      tone: 'bg-amber-500/20 ring-amber-500/35 dark:bg-amber-400/20 dark:ring-amber-400/35',
    },
    {
      label: 'Conversations started',
      value: volume.conversationsStarted.toLocaleString(),
      tone: 'bg-primary/20 ring-primary/35',
    },
    {
      label: 'Messages handled',
      value: volume.messagesHandled.toLocaleString(),
      tone: 'bg-violet-500/20 ring-violet-500/35 dark:bg-violet-400/20 dark:ring-violet-400/35',
    },
    {
      label: 'Deflection rate',
      value: formatPercent(deflection.deflectionRate),
      tone: 'bg-emerald-500/20 ring-emerald-500/35 dark:bg-emerald-400/20 dark:ring-emerald-400/35',
    },
    {
      label: 'CSAT',
      value: csat.sufficientSample ? `${csat.averageRating!.toFixed(1)} / 5` : 'Not enough data yet',
      tone: 'bg-amber-500/20 ring-amber-500/35 dark:bg-amber-400/20 dark:ring-amber-400/35',
    },
    {
      label: 'Orders / bookings secured',
      value: commerce.outcomesSecured.toLocaleString(),
      tone: 'bg-sky-500/20 ring-sky-500/35 dark:bg-sky-400/20 dark:ring-sky-400/35',
    },
    {
      label: 'Handoff rate',
      value: formatPercent(deflection.deflectionRate === null ? null : 1 - deflection.deflectionRate),
      tone: 'bg-orange-500/20 ring-orange-500/35 dark:bg-orange-400/20 dark:ring-orange-400/35',
    },
    {
      label: 'Payment conversion',
      value: formatPercent(commerce.paymentConversionRate),
      tone: 'bg-teal-500/20 ring-teal-500/35 dark:bg-teal-400/20 dark:ring-teal-400/35',
    },
  ];

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <PageHeader title="Analytics" description="How your AI assistant is performing with customers." />

      <div className="flex flex-wrap items-center gap-2">
        {RANGE_OPTIONS.map((r) => (
          <Link
            key={r.value}
            href={`/dashboard/analytics?range=${r.value}`}
            className={`rounded-lg px-3 py-1.5 text-sm ring-1 transition-colors ${
              r.value === selectedRange.value
                ? 'bg-primary text-primary-foreground ring-primary'
                : 'bg-card text-foreground ring-foreground/10 hover:ring-foreground/20'
            }`}
          >
            {r.label}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {headlineCards.map((c) => (
          <Card key={c.label} className={c.tone}>
            <CardHeader>
              <CardTitle className="text-sm font-normal text-muted-foreground">{c.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <h2 className="mb-2 font-heading text-sm font-semibold">Performance by platform</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {platformBreakdown.map((row) => (
            <Card key={row.platform}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  <span className="inline-flex items-center gap-2">
                    <PlatformBadge platform={PLATFORM_BADGE[row.platform]} className="size-6 rounded-lg shadow-none" iconClassName="size-3" />
                    {PLATFORM_LABEL[row.platform]}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p className="text-muted-foreground">Conversations: {row.conversationsStarted}</p>
                <p>Response rate: {formatPercent(row.responseRate)}</p>
                <p>Performance: {formatPercent(row.performanceRate)}</p>
                <p>Conversion: {formatPercent(row.conversionRate)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-2 font-heading text-sm font-semibold">Sentiment health</h2>
        <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          {sentiment.activeConversations === 0 ? (
            <p className="text-sm text-muted-foreground">No active conversations in this range.</p>
          ) : (
            <>
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
                {(Object.keys(SENTIMENT_LABELS) as SentimentBucket[]).map((bucket) => {
                  const pct = sentiment.percentages[bucket] * 100;
                  if (pct <= 0) return null;
                  return <div key={bucket} className={SENTIMENT_COLORS[bucket]} style={{ width: `${pct}%` }} />;
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {(Object.keys(SENTIMENT_LABELS) as SentimentBucket[]).map((bucket) => (
                  <div key={bucket} className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${SENTIMENT_COLORS[bucket]}`} />
                    {SENTIMENT_LABELS[bucket]} ({sentiment.counts[bucket]})
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <AnalyticsInfoDialog audience="client" />
    </div>
  );
}
