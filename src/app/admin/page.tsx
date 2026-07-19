import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { getAgencyNeedsAttention } from '@/services/overview';
import { PageHeader } from '@/components/page-header';

const NEEDS_ATTENTION_CARDS = [
  { key: 'ordersToApprove', label: 'Orders to approve', href: '/admin/orders?status=pending' },
  { key: 'paymentsToVerify', label: 'Payments to verify', href: '/admin/orders' },
  { key: 'liveHandoffs', label: 'Live handoffs', href: '/admin/chat' },
  { key: 'flaggedChats', label: 'Flagged chats', href: '/admin/chat' },
  { key: 'channelRequests', label: 'Channel requests', href: '/admin/clients' },
] as const;

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

  const stats = [
    { label: 'Clients', value: tenantCount ?? 0 },
    { label: 'Active conversations (24h)', value: activeSessionCount ?? 0 },
    { label: 'Human handoffs', value: handoffCount ?? 0 },
  ];

  return (
    <div className="space-y-6 p-6">
      <PageHeader title="Overview" description="Snapshot of activity across all clients." />

      <div>
        <h2 className="mb-2 font-heading text-sm font-semibold">Needs attention</h2>
        {attentionTotal === 0 ? (
          <div className="rounded-xl bg-card p-4 text-sm text-muted-foreground ring-1 ring-foreground/10">
            All clear ✓
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {NEEDS_ATTENTION_CARDS.map((c) => {
              const count = needsAttention[c.key];
              return (
                <Link
                  key={c.key}
                  href={c.href}
                  className={`rounded-xl p-4 ring-1 transition-colors ${
                    count > 0
                      ? 'bg-card ring-foreground/10 hover:ring-foreground/20'
                      : 'bg-card/40 text-muted-foreground ring-foreground/5'
                  }`}
                >
                  <p className={`text-2xl font-semibold ${count === 0 ? 'text-muted-foreground' : ''}`}>{count}</p>
                  <p className="mt-1 text-xs">{c.label}</p>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader>
              <CardTitle className="text-sm font-normal text-muted-foreground">{s.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <h2 className="mb-2 font-heading text-sm font-semibold">Recent usage</h2>
        <div className="rounded-xl bg-card ring-1 ring-foreground/10">
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
                    {new Date(row.created_at).toLocaleString()}
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
