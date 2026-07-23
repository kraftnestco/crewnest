import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/page-header';
import { getVolume, getDeflection, getCostBreakdown, getSentimentHealth, getCsat } from '@/services/analytics';
import type { DateRange, SentimentBucket } from '@/services/analytics';
import { MIN_CSAT_SAMPLE } from '@/lib/constants';

/**
 * docs/16-ANALYTICS-AND-PROOF.md §5 — the agency proof layer. Date range and
 * per-tenant sort are both plain `?range=`/`?sort=` links (no date-picker
 * component exists yet, docs/16 §3 rules out materialized views for Phase 3,
 * so this is a fully server-rendered, on-the-fly page — same shape as
 * orders-view.tsx's `?status=` filter, minus the client component since
 * nothing here needs interactivity beyond navigation).
 */

const RANGE_OPTIONS = [
  { value: '7d', label: '7 days', days: 7 },
  { value: '30d', label: '30 days', days: 30 },
  { value: '90d', label: '90 days', days: 90 },
] as const;

const SORT_OPTIONS = [
  { value: 'cost', label: 'Cost' },
  { value: 'volume', label: 'Volume' },
  { value: 'deflection', label: 'Deflection' },
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

function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; sort?: string }>;
}) {
  const { range: rangeParam, sort: sortParam } = await searchParams;
  const selectedRange = RANGE_OPTIONS.find((r) => r.value === rangeParam) ?? RANGE_OPTIONS[1];
  const sortKey = SORT_OPTIONS.find((s) => s.value === sortParam)?.value ?? 'cost';

  // eslint-disable-next-line react-hooks/purity -- Server Component render runs once per request; wall-clock cutoff is intentional
  const to = new Date();
  const from = new Date(to.getTime() - selectedRange.days * 24 * 60 * 60 * 1000);
  const range: DateRange = { from: from.toISOString(), to: to.toISOString() };

  const supabase = await createSupabaseServerClient();

  const [volume, deflection, cost, sentiment, csat, { data: tenantRows }] = await Promise.all([
    getVolume(null, range),
    getDeflection(null, range),
    getCostBreakdown(null, range),
    getSentimentHealth(null, range),
    getCsat(null, range),
    supabase.from('tenants').select('id, business_name').order('business_name'),
  ]);

  const tenants = tenantRows ?? [];
  const perTenant = await Promise.all(
    tenants.map(async (t) => {
      const [tVolume, tDeflection, tCost] = await Promise.all([
        getVolume(t.id, range),
        getDeflection(t.id, range),
        getCostBreakdown(t.id, range),
      ]);
      return { tenantId: t.id, businessName: t.business_name, volume: tVolume, deflection: tDeflection, cost: tCost };
    }),
  );

  const sortedTenants = [...perTenant].sort((a, b) => {
    if (sortKey === 'volume') return b.volume.conversationsStarted - a.volume.conversationsStarted;
    if (sortKey === 'deflection') return (b.deflection.deflectionRate ?? -1) - (a.deflection.deflectionRate ?? -1);
    return b.cost.totalCostUsd - a.cost.totalCostUsd;
  });

  const headlineCards = [
    { label: 'Conversations started', value: volume.conversationsStarted.toLocaleString() },
    { label: 'Deflection rate', value: formatPercent(deflection.deflectionRate) },
    {
      label: 'Cost (BYOK / platform)',
      value: `${formatUsd(cost.byokCostUsd)} / ${formatUsd(cost.masterCostUsd)}`,
    },
    {
      label: 'CSAT',
      value: csat.sufficientSample ? `${csat.averageRating!.toFixed(1)} / 5` : 'Not enough data yet',
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <PageHeader title="Analytics" description="Proof layer: volume, deflection, cost, and satisfaction across all clients." />

      <div className="flex flex-wrap items-center gap-2">
        {RANGE_OPTIONS.map((r) => (
          <Link
            key={r.value}
            href={`/admin/analytics?range=${r.value}&sort=${sortKey}`}
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

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-heading text-sm font-semibold">By client</h2>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            Sort by:
            {SORT_OPTIONS.map((s) => (
              <Link
                key={s.value}
                href={`/admin/analytics?range=${selectedRange.value}&sort=${s.value}`}
                className={s.value === sortKey ? 'font-semibold text-foreground' : 'hover:text-foreground'}
              >
                {s.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="rounded-xl bg-card ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Conversations</TableHead>
                <TableHead>Deflection</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Cost / conversation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedTenants.map((t) => (
                <TableRow key={t.tenantId}>
                  <TableCell className="font-medium">{t.businessName}</TableCell>
                  <TableCell>{t.volume.conversationsStarted}</TableCell>
                  <TableCell>{formatPercent(t.deflection.deflectionRate)}</TableCell>
                  <TableCell>{formatUsd(t.cost.totalCostUsd)}</TableCell>
                  <TableCell>
                    {t.cost.costPerConversation === null ? '—' : formatUsd(t.cost.costPerConversation)}
                  </TableCell>
                </TableRow>
              ))}
              {sortedTenants.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No clients yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
