import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, ChevronRight, Rocket } from 'lucide-react';
import { getCallerContext, resolveActiveTenant } from '@/lib/auth/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getTenantAttentionItems, getCrewCards } from '@/services/overview';
import { countSessionsToday } from '@/services/sessions';
import { entitlementsFor, isLimited } from '@/lib/entitlements';
import { PAYWALL_PLANS } from '@/services/demo/plans';
import { formatRelativeTime } from '@/lib/relative-time';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BusinessCopilot } from '@/components/copilot/business-copilot';
import { CrewStrip } from './crew-strip';

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  facebook: 'Messenger',
  instagram: 'Instagram',
  web: 'Website chat',
};

/**
 * Client home (docs/14 §6, reshaped by docs/27 §7.1). One Home for every plan
 * and role: needs-attention is always visible (never folded into the copilot
 * or hidden behind a paywall), the copilot sits below it as a section rather
 * than replacing the page, and the activity numbers close it out.
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
    attentionItems,
    { data: tenant },
    { count: conversationsHandled30d },
    { count: activeConversations },
    { count: ordersThisMonth },
    { count: appointmentsThisMonth },
    conversationsToday,
    { data: ratingRows },
  ] = await Promise.all([
    getTenantAttentionItems(activeTenantId, 5),
    supabase
      .from('tenants')
      .select('business_name, whatsapp_phone_number_id, meta_page_id, instagram_id, widget_public_key, plan, business_type, booking_enabled')
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
    supabase
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', activeTenantId)
      .neq('status', 'cancelled')
      .gte('created_at', monthStart),
    countSessionsToday(activeTenantId),
    supabase.from('orders').select('review_rating').eq('tenant_id', activeTenantId).not('review_rating', 'is', null),
  ]);

  const ratings = (ratingRows ?? []).map((r) => r.review_rating).filter((r): r is number => r !== null);
  const avgRating = ratings.length > 0 ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : null;

  // Plan entitlements drive both the quota banner and whether the Copilot shows
  // (lib/entitlements.ts is the single source of truth — see its header note on
  // why marketing copy and enforcement must not live in separate places).
  const entitlements = entitlementsFor(tenant?.plan);
  const hasCopilot = entitlements.hasCopilot;
  const dailyCap = entitlements.dailyConversations;
  // The daily cap now applies to Starter/Growth too, not just free — so the
  // banner is shown for any LIMITED plan rather than keyed off plan === 'free'.
  const showQuotaBanner = isLimited(dailyCap);
  const quotaRemaining = Math.max(0, dailyCap - conversationsToday);
  const planLabel = PAYWALL_PLANS.find((p) => p.id === tenant?.plan)?.name ?? 'Free';

  const channelConnected: Record<string, boolean> = {
    whatsapp: Boolean(tenant?.whatsapp_phone_number_id),
    facebook: Boolean(tenant?.meta_page_id),
    instagram: Boolean(tenant?.instagram_id),
    web: Boolean(tenant?.widget_public_key),
  };
  const connectedChannels = Object.entries(channelConnected)
    .filter(([, connected]) => connected)
    .map(([key]) => CHANNEL_LABELS[key]);

  // docs/27 §7.4 — the hero metric is whichever number proves the AI is doing
  // the job: appointments for a service business that has booking on, orders
  // for everyone else.
  const showBookings = tenant?.business_type === 'service' && Boolean(tenant?.booking_enabled);
  const heroStat = showBookings
    ? { label: 'Appointments booked this month', value: appointmentsThisMonth ?? 0 }
    : { label: 'Orders this month', value: ordersThisMonth ?? 0 };
  const secondaryStats = [
    { label: 'Customers answered this month', value: conversationsHandled30d ?? 0 },
    { label: 'Chats happening today', value: activeConversations ?? 0 },
  ];
  const hasActivity = heroStat.value > 0 || secondaryStats.some((s) => s.value > 0);

  const attentionOverflow = attentionItems.total - attentionItems.items.length;

  // docs/27 §7.5 — needs `showBookings`/`connectedChannels`, both only known
  // once the tenant row is back, so this can't join the query batch above.
  const crewCards = await getCrewCards(activeTenantId, {
    hasChannels: connectedChannels.length > 0,
    showBookings,
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title={`Welcome back${tenant ? `, ${tenant.business_name}` : ''}`}
        description="Here's what's happening with your AI assistant."
      />

      {showQuotaBanner && (
        <div
          className={`rounded-xl p-4 text-sm ring-1 ${
            quotaRemaining === 0
              ? 'bg-destructive/10 text-destructive ring-destructive/20'
              : 'bg-card ring-foreground/10'
          }`}
        >
          <span className="font-medium">{planLabel} plan:</span>{' '}
          {quotaRemaining === 0
            ? "You've used all of today's new-conversation slots. New customers won't get a reply until tomorrow."
            : `${quotaRemaining} of ${dailyCap} new conversations left today.`}{' '}
          <Link href="/dashboard/billing" className="underline underline-offset-2">
            {quotaRemaining === 0 ? 'Upgrade for more' : 'See plans'}
          </Link>
        </div>
      )}

      {/* docs/27 §7.1/§7.2 — the needs-attention queue, always visible regardless
          of plan or role, one human sentence + one action per row. */}
      <div>
        <h2 className="mb-2 font-heading text-sm font-semibold">Needs attention</h2>
        {attentionItems.items.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl bg-card p-4 text-sm text-muted-foreground ring-1 ring-foreground/10">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
            Nothing needs you right now.
          </div>
        ) : (
          <>
            <Card>
              <CardContent className="divide-y p-0">
                {attentionItems.items.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{item.sentence}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{formatRelativeTime(item.timestamp, now)}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                ))}
              </CardContent>
            </Card>
            {attentionOverflow > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                +{attentionOverflow} more waiting — see{' '}
                <Link href="/dashboard/orders" className="underline underline-offset-2">
                  My Orders
                </Link>{' '}
                and{' '}
                <Link href="/dashboard/chat" className="underline underline-offset-2">
                  My Inbox
                </Link>
                .
              </p>
            )}
          </>
        )}
      </div>

      {/* docs/27 §7.5 — one card per capability actually switched on, below the queue. */}
      <CrewStrip cards={crewCards} now={now} />

      {/* Owners below Growth see what the AI assistant is, rather than nothing
          where the Copilot would be — the upgrade path is the point of the tier. */}
      {canEditBusiness && !hasCopilot && (
        <div className="rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10">
          <p className="font-medium">Get your own AI assistant</p>
          <p className="mt-1 text-muted-foreground">
            On Growth, CrewAI helps you run {tenant?.business_name ?? 'your business'} — update your
            catalogue, hours, and prices just by describing the change.
          </p>
          <Link
            href="/dashboard/billing"
            className="mt-2 inline-block text-primary underline underline-offset-2"
          >
            See plans
          </Link>
        </div>
      )}

      {/* Owners on Growth+ get the copilot as a section of Home, not the whole
          page — needs-attention and activity numbers now live above it, so it
          no longer folds its own overview panel in. */}
      {canEditBusiness && hasCopilot && (
        <BusinessCopilot tenantId={activeTenantId} businessName={tenant?.business_name ?? 'your business'} />
      )}

      {/* docs/27 §7.4 — one hero-sized number that proves the assistant is
          working, plus the supporting activity stats. */}
      <div>
        <h2 className="mb-2 font-heading text-sm font-semibold">Last 30 days</h2>
        {!hasActivity ? (
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
          <div className="flex flex-col gap-4">
            <Card className="bg-primary/5 ring-1 ring-primary/15">
              <CardHeader>
                <CardTitle className="text-sm font-normal text-muted-foreground">{heroStat.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-4xl font-semibold tabular-nums">{heroStat.value}</p>
              </CardContent>
            </Card>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {secondaryStats.map((t) => (
                <Card key={t.label}>
                  <CardHeader>
                    <CardTitle className="text-sm font-normal text-muted-foreground">{t.label}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold tabular-nums">{t.value}</p>
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
          </div>
        )}
      </div>
    </div>
  );
}
