import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Rocket } from 'lucide-react';
import { getCallerContext, resolveActiveTenant } from '@/lib/auth/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getTenantNeedsAttention } from '@/services/overview';
import { countSessionsToday } from '@/services/sessions';
import { FREE_PLAN_DAILY_SESSION_CAP } from '@/lib/constants';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BusinessCopilot, type CopilotOverview } from '@/components/copilot/business-copilot';

const NEEDS_ATTENTION_CARDS = [
  { key: 'ordersToApprove', label: 'Pending orders', href: '/dashboard/orders?status=pending' },
  { key: 'paymentsToVerify', label: 'Payments to verify', href: '/dashboard/orders' },
  { key: 'liveHandoffs', label: 'Live handoffs', href: '/dashboard/chat' },
  { key: 'flaggedChats', label: 'Flagged chats', href: '/dashboard/chat' },
] as const;

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  facebook: 'Messenger',
  instagram: 'Instagram',
  web: 'Website chat',
};

/**
 * Client home (docs/14 §6). Was a bare redirect to /dashboard/chat — now a real
 * landing page: needs-attention (shared with the agency Overview, §5.2), a light
 * value teaser, and a getting-started state for a tenant with no activity yet.
 */
export default async function DashboardHomePage() {
  const ctx = await getCallerContext(); // layout already gated; re-derive (React cache dedupes)
  if (!ctx) redirect('/login');
  const cookieStore = await cookies();
  const activeTenantId = resolveActiveTenant(ctx, cookieStore.get('cn_active_tenant')?.value);
  // Layout already redirects away when ctx.memberships is empty, so this is always
  // defined in practice — redirect to /login rather than back to /dashboard to
  // avoid a self-loop if that guarantee is ever weakened.
  if (!activeTenantId) redirect('/login');

  const activeMembership = ctx.memberships.find((m) => m.tenantId === activeTenantId);
  const canEditBusiness = activeMembership?.role === 'tenant_admin';

  const supabase = await createSupabaseServerClient();
  // eslint-disable-next-line react-hooks/purity -- Server Component render runs once per request; wall-clock cutoffs are intentional
  const now = Date.now();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).toISOString();

  const [
    needsAttention,
    { data: tenant },
    { count: conversationsHandled30d },
    { count: activeConversations },
    { count: ordersThisMonth },
    conversationsToday,
    { data: ratingRows },
  ] = await Promise.all([
    getTenantNeedsAttention(activeTenantId),
    supabase
      .from('tenants')
      .select('business_name, whatsapp_phone_number_id, meta_page_id, instagram_id, widget_public_key, plan')
      .eq('id', activeTenantId)
      .single(),
    supabase
      .from('chat_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', activeTenantId)
      .gte('created_at', thirtyDaysAgo),
    supabase
      .from('chat_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', activeTenantId)
      .gte('last_message_at', dayAgo),
    supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', activeTenantId)
      .gte('created_at', monthStart),
    countSessionsToday(activeTenantId),
    supabase.from('orders').select('review_rating').eq('tenant_id', activeTenantId).not('review_rating', 'is', null),
  ]);

  const ratings = (ratingRows ?? []).map((r) => r.review_rating).filter((r): r is number => r !== null);
  const avgRating = ratings.length > 0 ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : null;

  const isFreePlan = tenant?.plan === 'free';
  const freeQuotaRemaining = Math.max(0, FREE_PLAN_DAILY_SESSION_CAP - conversationsToday);

  const channelConnected: Record<string, boolean> = {
    whatsapp: Boolean(tenant?.whatsapp_phone_number_id),
    facebook: Boolean(tenant?.meta_page_id),
    instagram: Boolean(tenant?.instagram_id),
    web: Boolean(tenant?.widget_public_key),
  };
  const connectedChannels = Object.entries(channelConnected)
    .filter(([, connected]) => connected)
    .map(([key]) => CHANNEL_LABELS[key]);

  const teaser = [
    { label: 'Conversations handled (30d)', value: conversationsHandled30d ?? 0 },
    { label: 'Active conversations (24h)', value: activeConversations ?? 0 },
    { label: 'Orders this month', value: ordersThisMonth ?? 0 },
  ];
  const hasActivity = teaser.some((t) => t.value > 0);
  const attentionTotal = NEEDS_ATTENTION_CARDS.reduce((sum, c) => sum + needsAttention[c.key], 0);

  // Feeds the copilot's folded-in overview panel (tenant_admin only — see below).
  // Kept as a plain object built from the same queries above rather than a new
  // fetch, so the two surfaces can never disagree.
  const overview: CopilotOverview = {
    hasActivity,
    connectedChannels,
    needsAttention: NEEDS_ATTENTION_CARDS.map((c) => ({
      key: c.key,
      label: c.label,
      count: needsAttention[c.key],
      href: c.href,
    })),
    stats: teaser,
    avgRating: avgRating !== null ? { value: avgRating, count: ratings.length } : null,
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={`Welcome back${tenant ? `, ${tenant.business_name}` : ''}`}
        description="Here's what's happening with your AI assistant."
      />

      {isFreePlan && (
        <div
          className={`rounded-xl p-4 text-sm ring-1 ${
            freeQuotaRemaining === 0
              ? 'bg-destructive/10 text-destructive ring-destructive/20'
              : 'bg-card ring-foreground/10'
          }`}
        >
          <span className="font-medium">Free plan:</span>{' '}
          {freeQuotaRemaining === 0
            ? "You've used all of today's new-conversation slots. New customers won't get a reply until tomorrow."
            : `${freeQuotaRemaining} of ${FREE_PLAN_DAILY_SESSION_CAP} new conversations left today.`}
        </div>
      )}

      {canEditBusiness ? (
        // Owners get the copilot as the home surface — needs-attention/activity
        // stats live inside it as an overview instead of as separate cards.
        <BusinessCopilot tenantId={activeTenantId} businessName={tenant?.business_name ?? 'your business'} overview={overview} />
      ) : !hasActivity ? (
        // Staff (tenant_agent) can't edit the business, so they keep the plain
        // stat view — no copilot, nothing to fold it into.
        <EmptyState
          icon={Rocket}
          title={
            connectedChannels.length > 0
              ? `Your AI assistant is live on ${connectedChannels.join(', ')}`
              : 'Your AI assistant is almost ready'
          }
          hint="This is where your customer chats and orders will show up once conversations start coming in."
        />
      ) : (
        <>
          <div>
            <h2 className="mb-2 font-heading text-sm font-semibold">Needs attention</h2>
            {attentionTotal === 0 ? (
              <div className="rounded-xl bg-card p-4 text-sm text-muted-foreground ring-1 ring-foreground/10">
                All clear ✓
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {teaser.map((t) => (
              <Card key={t.label}>
                <CardHeader>
                  <CardTitle className="text-sm font-normal text-muted-foreground">{t.label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-semibold">{t.value}</p>
                </CardContent>
              </Card>
            ))}
            {avgRating !== null && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-normal text-muted-foreground">
                    Average rating ({ratings.length} review{ratings.length === 1 ? '' : 's'})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-semibold">
                    {avgRating.toFixed(1)}/5{' '}
                    <span className="text-base text-amber-500">
                      {'★'.repeat(Math.round(avgRating))}
                      {'☆'.repeat(5 - Math.round(avgRating))}
                    </span>
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
