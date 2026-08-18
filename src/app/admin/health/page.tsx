import Link from 'next/link';
import {
  AlertTriangle,
  CircleDollarSign,
  Frown,
  MessageSquareOff,
  WalletCards,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { HomeIcon, type HomeIconTone } from '@/components/home-icon';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime } from '@/lib/format-date';
import { getSystemHealth } from '@/services/systemHealth';

const HEALTH_CARDS: {
  key: 'failedDeliveries' | 'failedPayments' | 'unhappyCustomers' | 'cancellationRisk' | 'costAlertsUnread';
  label: string;
  icon: LucideIcon;
  tone: HomeIconTone;
}[] = [
  { key: 'failedDeliveries', label: 'Failed deliveries', icon: MessageSquareOff, tone: 'orange' },
  { key: 'failedPayments', label: 'Failed payments', icon: WalletCards, tone: 'sky' },
  { key: 'unhappyCustomers', label: 'Unhappy customers', icon: Frown, tone: 'violet' },
  { key: 'cancellationRisk', label: 'At risk of cancelling', icon: AlertTriangle, tone: 'amber' },
  { key: 'costAlertsUnread', label: 'Cost-cap alerts', icon: CircleDollarSign, tone: 'rose' },
];

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
    <div className="space-y-6 p-4 lg:p-6">
      <PageHeader title="System health" description="Signals that need attention across all clients." />

      {total === 0 ? (
        <div className="rounded-xl bg-card p-4 text-sm text-muted-foreground ring-1 ring-foreground/10">
          All clear ✓
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          {HEALTH_CARDS.map((c) => {
            const count = counts[c.key];
            return (
              <div
                key={c.key}
                className={`flex items-center gap-3 rounded-xl p-4 ring-1 ${
                  count > 0 ? 'bg-card ring-foreground/10' : 'bg-card/40 text-muted-foreground ring-foreground/5'
                }`}
              >
                <HomeIcon icon={c.icon} tone={c.tone} className="size-9" />
                <div className="min-w-0">
                  <p className={`text-2xl font-semibold tabular-nums ${count === 0 ? 'text-muted-foreground' : ''}`}>
                    {count}
                  </p>
                  <p className="mt-0.5 text-xs">{c.label}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <h2 className="mb-2 font-heading text-sm font-semibold">Recent failed messages</h2>
          <div className="rounded-xl bg-card ring-1 ring-foreground/10 overflow-hidden">
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
                      {formatDateTime(row.createdAt)}
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
          <div className="rounded-xl bg-card ring-1 ring-foreground/10 overflow-hidden">
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
                      {formatDateTime(n.createdAt)}
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
