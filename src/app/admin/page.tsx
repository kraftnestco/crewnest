import Link from 'next/link';
import {
  Building2,
  ClipboardCheck,
  CreditCard,
  Flag,
  Headset,
  MessageCircle,
  Radio,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { HomeIcon, type HomeIconTone } from '@/components/home-icon';
import { getAgencyNeedsAttention } from '@/services/overview';
import { PageHeader } from '@/components/page-header';
import { formatDateTime } from '@/lib/format-date';

const NEEDS_ATTENTION_CARDS: {
  key: 'ordersToApprove' | 'paymentsToVerify' | 'liveHandoffs' | 'flaggedChats' | 'channelRequests';
  label: string;
  href: string;
  icon: LucideIcon;
  tone: HomeIconTone;
}[] = [
  { key: 'ordersToApprove', label: 'Orders to approve', href: '/admin/orders?status=pending', icon: ClipboardCheck, tone: 'amber' },
  { key: 'paymentsToVerify', label: 'Payments to verify', href: '/admin/orders', icon: CreditCard, tone: 'sky' },
  { key: 'liveHandoffs', label: 'Live handoffs', href: '/admin/chat', icon: Headset, tone: 'violet' },
  { key: 'flaggedChats', label: 'Flagged chats', href: '/admin/chat', icon: Flag, tone: 'orange' },
  { key: 'channelRequests', label: 'Channel requests', href: '/admin/clients', icon: Radio, tone: 'teal' },
];

export default async function OverviewPage() {
  const supabase = await createSupabaseServerClient();
  // eslint-disable-next-line react-hooks/purity -- Server Component render runs once per request; wall-clock cutoff is intentional
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: tenantCount },
    { count: activeSessionCount },
    { count: handoffCount },
    { data: usageRows },
    needsAttention,
  ] = await Promise.all([
    supabase.from('tenants').select('*', { count: 'exact', head: true }),
    supabase
      .from('chat_sessions')
      .select('*', { count: 'exact', head: true })
      .gte('last_message_at', dayAgo),
    supabase
      .from('chat_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('is_human_handoff', true),
    supabase
      .from('usage_logs')
      .select('id, tenant_id, provider, model, total_tokens, estimated_cost_usd, used_byok, created_at')
      .order('created_at', { ascending: false })
      .limit(10),
    getAgencyNeedsAttention(),
  ]);

  const attentionTotal = NEEDS_ATTENTION_CARDS.reduce((sum, c) => sum + needsAttention[c.key], 0);

  const tenantIds = [...new Set((usageRows ?? []).map((r) => r.tenant_id))];
  const { data: tenantRows } =
    tenantIds.length > 0
      ? await supabase.from('tenants').select('id, business_name').in('id', tenantIds)
      : { data: [] };
  const tenantNameById = new Map((tenantRows ?? []).map((t) => [t.id, t.business_name]));

  const stats: { label: string; value: number; icon: LucideIcon; tone: HomeIconTone }[] = [
    { label: 'Clients', value: tenantCount ?? 0, icon: Building2, tone: 'primary' },
    { label: 'Active conversations (24h)', value: activeSessionCount ?? 0, icon: MessageCircle, tone: 'success' },
    { label: 'Human handoffs', value: handoffCount ?? 0, icon: Headset, tone: 'rose' },
  ];

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <PageHeader title="Overview" description="Snapshot of activity across all clients." />

      <div>
        <h2 className="mb-2 font-heading text-sm font-semibold">Needs attention</h2>
        {attentionTotal === 0 ? (
          <div className="rounded-xl bg-card p-4 text-sm text-muted-foreground ring-1 ring-foreground/10">
            All clear ✓
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            {NEEDS_ATTENTION_CARDS.map((c) => {
              const count = needsAttention[c.key];
              return (
                <Link
                  key={c.key}
                  href={c.href}
                  className={`flex items-center gap-3 rounded-xl p-4 ring-1 transition-colors ${
                    count > 0
                      ? 'bg-card ring-foreground/10 hover:ring-foreground/20'
                      : 'bg-card/40 text-muted-foreground ring-foreground/5'
                  }`}
                >
                  <HomeIcon icon={c.icon} tone={c.tone} className="size-9" />
                  <div className="min-w-0">
                    <p className={`text-2xl font-semibold tabular-nums ${count === 0 ? 'text-muted-foreground' : ''}`}>
                      {count}
                    </p>
                    <p className="mt-0.5 text-xs">{c.label}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-3 p-4">
              <HomeIcon icon={s.icon} tone={s.tone} />
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{s.label}</p>
                <p className="mt-0.5 text-2xl font-semibold tabular-nums">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <h2 className="mb-2 font-heading text-sm font-semibold">Recent usage</h2>
        <div className="rounded-xl bg-card ring-1 ring-foreground/10 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Provider / model</TableHead>
                <TableHead>Tokens</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(usageRows ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{tenantNameById.get(row.tenant_id) ?? 'Unknown'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.provider} / {row.model}
                  </TableCell>
                  <TableCell>{row.total_tokens}</TableCell>
                  <TableCell>${row.estimated_cost_usd.toFixed(4)}</TableCell>
                  <TableCell>
                    <Badge variant={row.used_byok ? 'secondary' : 'outline'}>
                      {row.used_byok ? 'BYOK' : 'Platform'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDateTime(row.created_at)}
                  </TableCell>
                </TableRow>
              ))}
              {(!usageRows || usageRows.length === 0) && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No usage yet.
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
