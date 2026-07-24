import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getSystemHealth } from '@/services/systemHealth';

const HEALTH_CARDS = [
  { key: 'failedDeliveries', label: 'Failed deliveries' },
  { key: 'failedPayments', label: 'Failed payments' },
  { key: 'unhappyCustomers', label: 'Unhappy customers' },
  { key: 'cancellationRisk', label: 'At risk of cancelling' },
  { key: 'costAlertsUnread', label: 'Cost-cap alerts' },
] as const;

/** docs/20 Part 1 — read-only triage dashboard over signals that already exist; no new table, no migration. */
export default async function SystemHealthPage() {
  const health = await getSystemHealth();

  const counts: Record<(typeof HEALTH_CARDS)[number]['key'], number> = {
    failedDeliveries: health.failedDeliveries,
    failedPayments: health.failedPayments,
    unhappyCustomers: health.unhappyCustomers,
    cancellationRisk: health.alertBreakdown.cancellation_risk,
    costAlertsUnread: health.costAlertsUnread,
  };
  const total = HEALTH_CARDS.reduce((sum, c) => sum + counts[c.key], 0);

  return (
    <div className="space-y-6 p-6">
      <PageHeader title="System health" description="Signals that need attention across all clients." />

      {total === 0 ? (
        <div className="rounded-xl bg-card p-4 text-sm text-muted-foreground ring-1 ring-foreground/10">
          All clear ✓
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {HEALTH_CARDS.map((c) => {
            const count = counts[c.key];
            return (
              <div
                key={c.key}
                className={`rounded-xl p-4 ring-1 ${
                  count > 0 ? 'bg-card ring-foreground/10' : 'bg-card/40 text-muted-foreground ring-foreground/5'
                }`}
              >
                <p className={`text-2xl font-semibold ${count === 0 ? 'text-muted-foreground' : ''}`}>{count}</p>
                <p className="mt-1 text-xs">{c.label}</p>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 font-heading text-sm font-semibold">Recent failed messages</h2>
          <div className="rounded-xl bg-card ring-1 ring-foreground/10">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {health.recentFailedDeliveries.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      <Link href={`/admin/chat?session=${row.sessionId}`} className="hover:underline">
                        {row.tenantName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
                {health.recentFailedDeliveries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2} className="py-8 text-center text-muted-foreground">
                      No failed messages.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <div>
          <h2 className="mb-2 font-heading text-sm font-semibold">Recent cost alerts</h2>
          <div className="rounded-xl bg-card ring-1 ring-foreground/10">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Alert</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {health.recentCostAlerts.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell className="font-medium">
                      <Link href={n.link} className="hover:underline">
                        {n.title}
                      </Link>
                      {n.body && <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(n.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
                {health.recentCostAlerts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2} className="py-8 text-center text-muted-foreground">
                      No cost alerts.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
}
