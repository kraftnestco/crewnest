import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCallerContext, resolveActiveTenant } from '@/lib/auth/context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/page-header';
import { getVolume, getDeflection, getSentimentHealth, getCsat } from '@/services/analytics';
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

function formatPercent(rate: number | null): string {
  return rate === null ? 'No data' : `${(rate * 100).toFixed(1)}%`;
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

  // eslint-disable-next-line react-hooks/purity -- Server Component render runs once per request; wall-clock cutoff is intentional
  const to = new Date();
  const from = new Date(to.getTime() - selectedRange.days * 24 * 60 * 60 * 1000);
  const range: DateRange = { from: from.toISOString(), to: to.toISOString() };

  const [volume, deflection, sentiment, csat] = await Promise.all([
    getVolume(activeTenantId, range),
    getDeflection(activeTenantId, range),
    getSentimentHealth(activeTenantId, range),
    getCsat(activeTenantId, range),
  ]);

  const headlineCards = [
    { label: 'Conversations started', value: volume.conversationsStarted.toLocaleString() },
    { label: 'Messages handled', value: volume.messagesHandled.toLocaleString() },
    { label: 'Deflection rate', value: formatPercent(deflection.deflectionRate) },
    {
      label: 'CSAT',
      value: csat.sufficientSample ? `${csat.averageRating!.toFixed(1)} / 5` : 'Not enough data yet',
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {headlineCards.map((c) => (
          <Card key={c.label}>
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
    </div>
  );
}
