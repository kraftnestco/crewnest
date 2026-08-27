import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  BarChart3,
  CheckCircle2,
  ChevronRight,
  DollarSign,
  MessageCircle,
  MessagesSquare,
  Rocket,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getCallerContext, resolveActiveTenant } from '@/lib/auth/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getTenantAttentionItems, getClerkCards } from '@/services/overview';
import { countConversationsThisMonth } from '@/services/conversationUsage';
import { entitlementsFor, isLimited } from '@/lib/entitlements';
import { PAYWALL_PLANS } from '@/services/demo/plans';
import { formatRelativeTime } from '@/lib/relative-time';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Card, CardContent } from '@/components/ui/card';
import { BusinessCopilot } from '@/components/copilot/business-copilot';
import { PlatformBadge, type PlatformId } from '@/app/_landing/platform-icons';
import { ClerkStrip } from './clerk-strip';
import { HomeIcon } from '@/components/home-icon';
import { getEcommerceMetrics, type DateRange } from '@/services/analytics';

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  facebook: 'Messenger',
  instagram: 'Instagram',
  web: 'Website chat',
};
const CHANNEL_BADGES: Record<string, PlatformId> = {
  whatsapp: 'whatsapp',
  facebook: 'messenger',
  instagram: 'instagram',
  web: 'web',
};

function QuotaRing({ remaining, total }: { remaining: number; total: number }) {
  const pct = total <= 0 ? 0 : Math.min(1, Math.max(0, remaining / total));
  const r = 26;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct);

  // The caption sits under the ring, not inside it — "Conversations left" can't
  // fit within the stroke at any legible size.
  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5" aria-hidden>
      <div className="relative size-20">
        <svg viewBox="0 0 64 64" className="size-full -rotate-90">
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            strokeWidth="5"
            className="stroke-muted"
          />
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            className="stroke-primary transition-[stroke-dashoffset]"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-semibold leading-none tracking-tight tabular-nums">
            {remaining}/{total}
          </span>
        </div>
      </div>
      <span className="text-[0.65rem] whitespace-nowrap text-muted-foreground">Conversations left</span>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  tone = 'primary',
  large = false,
}: {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  tone?: 'primary' | 'success';
  large?: boolean;
}) {
  return (
    <Card className={large ? 'bg-[color-mix(in_oklch,var(--card),var(--primary)_6%)] ring-1 ring-primary/15' : undefined}>
      <CardContent className="flex items-center gap-3 p-4">
        <HomeIcon icon={icon} tone={tone} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-muted-foreground">{label}</p>
          <p className="mt-0.5 whitespace-nowrap text-2xl font-semibold tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Client home (docs/14 §6, reshaped by docs/27 §7.1). One Home for every plan
 * and role: needs-attention is always visible (never folded into the copilot
 * or hidden behind a paywall), the copilot sits below it as a section rather
 * than replacing the page, and the activity numbers close it out.
 */
const SALES_RANGE_OPTIONS = [
  { value: '7d', label: '7 days', days: 7 },
  { value: '30d', label: '30 days', days: 30 },
  { value: '90d', label: '90 days', days: 90 },
  { value: 'mtd', label: 'This month', days: null },
] as const;

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

export default async function DashboardHomePage({
  searchParams,
}: {
  searchParams: Promise<{ salesRange?: string }>;
}) {
  const { salesRange: salesRangeParam } = await searchParams;
  const selectedSalesRange =
    SALES_RANGE_OPTIONS.find((r) => r.value === salesRangeParam) ?? SALES_RANGE_OPTIONS[1];

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
  const salesTo = new Date(now);
  const salesFrom =
    selectedSalesRange.value === 'mtd'
      ? new Date(monthStart)
      : new Date(now - (selectedSalesRange.days ?? 30) * 24 * 60 * 60 * 1000);
  const salesRange: DateRange = { from: salesFrom.toISOString(), to: salesTo.toISOString() };

  const [
    attentionItems,
    { data: tenant },
    { count: conversationsHandled30d },
    { count: activeConversations },
    { count: ordersThisMonth },
    { count: appointmentsThisMonth },
    conversationsThisMonth,
    { data: ratingRows },
    { data: sessions30d },
    { data: userMessages30d },
    { data: platformOrders30d },
    ecommerce,
  ] = await Promise.all([
    getTenantAttentionItems(activeTenantId, 5),
    supabase
      .from('tenants')
      .select('business_name, whatsapp_phone_number_id, meta_page_id, instagram_id, widget_public_key, plan, business_type, booking_enabled, default_currency')
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
    countConversationsThisMonth(activeTenantId),
    supabase.from('orders').select('review_rating').eq('tenant_id', activeTenantId).not('review_rating', 'is', null),
    supabase
      .from('chat_sessions')
      .select('id, platform')
      .eq('tenant_id', activeTenantId)
      .gte('created_at', thirtyDaysAgo),
    supabase
      .from('chat_messages')
      .select('session_id')
      .eq('tenant_id', activeTenantId)
      .eq('role', 'user')
      .gte('created_at', thirtyDaysAgo),
    supabase
      .from('orders')
      .select('platform')
      .eq('tenant_id', activeTenantId)
      .gte('created_at', thirtyDaysAgo),
    getEcommerceMetrics(activeTenantId, salesRange),
  ]);

  const ratings = (ratingRows ?? []).map((r) => r.review_rating).filter((r): r is number => r !== null);
  const avgRating = ratings.length > 0 ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : null;

  // Plan entitlements drive both the quota banner and whether the Copilot shows
  // (lib/entitlements.ts is the single source of truth — see its header note on
  // why marketing copy and enforcement must not live in separate places).
  const entitlements = entitlementsFor(tenant?.plan);
  const hasCopilot = entitlements.hasCopilot;
  const monthlyCap = entitlements.monthlyConversations;
  // Monthly conversation caps apply to every limited plan, not just free.
  const showQuotaBanner = isLimited(monthlyCap);
  const quotaRemaining = Math.max(0, monthlyCap - conversationsThisMonth);
  const planLabel = PAYWALL_PLANS.find((p) => p.id === tenant?.plan)?.name ?? 'Free';
  const moneyCurrency = ecommerce.primaryCurrency ?? tenant?.default_currency ?? null;

  const channelConnected: Record<string, boolean> = {
    whatsapp: Boolean(tenant?.whatsapp_phone_number_id),
    facebook: Boolean(tenant?.meta_page_id),
    instagram: Boolean(tenant?.instagram_id),
    web: Boolean(tenant?.widget_public_key),
  };
  const connectedChannels = Object.entries(channelConnected)
    .filter(([, connected]) => connected)
    .map(([key]) => CHANNEL_LABELS[key]);

  const sessionPlatformById = new Map((sessions30d ?? []).map((s) => [s.id, s.platform]));
  const platformStats = Object.keys(CHANNEL_LABELS).map((platform) => {
    const conversations = (sessions30d ?? []).filter((s) => s.platform === platform).length;
    const messages = (userMessages30d ?? []).filter((m) => sessionPlatformById.get(m.session_id) === platform).length;
    const orders = (platformOrders30d ?? []).filter((o) => o.platform === platform).length;
    return { platform, conversations, messages, orders };
  });

  // docs/27 §7.4 — the hero metric is whichever number proves the AI is doing
  // the job: appointments for a service business that has booking on, orders
  // for everyone else.
  const showBookings = tenant?.business_type === 'service' && Boolean(tenant?.booking_enabled);
  const heroStat = showBookings
    ? { label: 'Appointments booked this month', value: appointmentsThisMonth ?? 0, icon: BarChart3 }
    : { label: 'Orders this month', value: ordersThisMonth ?? 0, icon: BarChart3 };
  const secondaryStats = [
    { label: 'Customers answered this month', value: conversationsHandled30d ?? 0, icon: Users },
    { label: 'Chats happening today', value: activeConversations ?? 0, icon: MessageCircle },
  ];
  const hasActivity = heroStat.value > 0 || secondaryStats.some((s) => s.value > 0);

  const attentionOverflow = attentionItems.total - attentionItems.items.length;

  // docs/27 §7.5 — needs `showBookings`/`connectedChannels`, both only known
  // once the tenant row is back, so this can't join the query batch above.
  const clerkCards = await getClerkCards(activeTenantId, {
    hasChannels: connectedChannels.length > 0,
    showBookings,
  });

  return (
    <div className="flex flex-col gap-6 p-4 lg:p-6">
      <PageHeader
        title={`Welcome back${tenant ? `, ${tenant.business_name}` : ''} 👋`}
        description="Here's what's happening with your AI assistant."
      />

      {showQuotaBanner && (
        <div
          className={`flex items-center gap-3 rounded-xl p-4 ring-1 ${
            quotaRemaining === 0
              ? 'bg-destructive/10 text-destructive ring-destructive/20'
              : 'bg-card ring-foreground/10'
          }`}
        >
          <HomeIcon icon={MessagesSquare} tone={quotaRemaining === 0 ? 'primary' : 'primary'} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{planLabel} plan</p>
            <p className={`mt-0.5 text-sm ${quotaRemaining === 0 ? '' : 'text-muted-foreground'}`}>
              {quotaRemaining === 0
                ? "You've used all of this month's conversations. Upgrade so new customers keep getting AI replies."
                : `${quotaRemaining} of ${monthlyCap.toLocaleString('en-US')} conversations left this month.`}
            </p>
            <Link
              href="/dashboard/billing"
              className={`mt-1 inline-block text-sm underline-offset-2 hover:underline ${
                quotaRemaining === 0 ? 'underline' : 'text-primary'
              }`}
            >
              {quotaRemaining === 0 ? 'Upgrade for more →' : 'See plans →'}
            </Link>
          </div>
          {quotaRemaining > 0 && <QuotaRing remaining={quotaRemaining} total={monthlyCap} />}
        </div>
      )}

      {/* Sales snapshot — revenue / net / AOV for a selectable period. */}
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-semibold">Sales &amp; profit</h2>
          <div className="flex flex-wrap items-center gap-1.5">
            {SALES_RANGE_OPTIONS.map((r) => (
              <Link
                key={r.value}
                href={`/dashboard?salesRange=${r.value}`}
                className={`rounded-lg px-2.5 py-1 text-xs ring-1 transition-colors ${
                  r.value === selectedSalesRange.value
                    ? 'bg-primary text-primary-foreground ring-primary'
                    : 'bg-card text-foreground ring-foreground/10 hover:ring-foreground/20'
                }`}
              >
                {r.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Revenue earned"
            value={formatMoney(ecommerce.revenuePaid, moneyCurrency)}
            icon={DollarSign}
            large
          />
          <StatCard
            label="Net profit"
            value={formatMoney(ecommerce.netProfit, moneyCurrency)}
            icon={TrendingUp}
            tone="success"
          />
          <StatCard
            label="Product cost (COGS)"
            value={formatMoney(ecommerce.cogs, moneyCurrency)}
            icon={Wallet}
          />
          <StatCard
            label="Expenses"
            value={formatMoney(ecommerce.operatingExpenses, moneyCurrency)}
            icon={ShoppingBag}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Net profit = revenue − refunds − COGS − expenses
          {ecommerce.repeatBuyers > 0 ? ` · ${ecommerce.repeatBuyers} repeat buyers` : ''}
          {ecommerce.ordersPaid > 0
            ? ` · ${ecommerce.ordersPaid} paid · ${ecommerce.itemsSold} items sold`
            : ecommerce.ordersSecured > 0
              ? ` · ${ecommerce.ordersSecured} secured orders`
              : ' · No paid orders in this period yet'}
          {ecommerce.multiCurrency ? ' · Mixed currencies — totals use the primary currency only' : ''}.{' '}
          <Link href="/dashboard/finance" className="underline underline-offset-2">
            Manage finances →
          </Link>
        </p>
      </div>

      {/* docs/27 §7.1/§7.2 — the needs-attention queue, always visible regardless
          of plan or role, one human sentence + one action per row. */}
      <div>
        {attentionItems.items.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <HomeIcon icon={CheckCircle2} tone="success" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Needs attention</p>
              <p className="mt-0.5 text-sm text-muted-foreground">Nothing needs you right now.</p>
            </div>
          </div>
        ) : (
          <>
            <h2 className="mb-2 font-heading text-sm font-semibold">Needs attention</h2>
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
      <ClerkStrip cards={clerkCards} now={now} />

      {/* Owners below Growth see what the AI assistant is, rather than nothing
          where the Copilot would be — the upgrade path is the point of the tier. */}
      {canEditBusiness && !hasCopilot && (
        <div className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:flex-row sm:items-center">
          <HomeIcon icon={Sparkles} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Get your own AI assistant</p>
            <p className="mt-1 text-sm text-muted-foreground">
              On Growth, ClerkAI helps you run {tenant?.business_name ?? 'your business'} — update your
              catalogue, hours, and prices just by describing the change.
            </p>
          </div>
          <Link
            href="/dashboard/billing"
            className="shrink-0 self-start rounded-lg border border-primary/40 px-3 py-1.5 text-sm text-primary transition-colors hover:bg-primary/10 sm:self-center"
          >
            See plans →
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
        <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {platformStats.map((stat) => (
            <Card key={stat.platform}>
              <CardContent className="p-3">
                <div className="mb-2 flex items-center gap-2">
                  <PlatformBadge platform={CHANNEL_BADGES[stat.platform]} className="size-6 rounded-lg shadow-none" iconClassName="size-3" />
                  <p className="text-sm font-medium">{CHANNEL_LABELS[stat.platform]}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {stat.messages} msgs · {stat.orders} orders · {stat.conversations} chats
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
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
          <div className="grid gap-3">
            <StatCard
              label={heroStat.label}
              value={heroStat.value}
              icon={heroStat.icon}
              large
            />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              {secondaryStats.map((t) => (
                <StatCard key={t.label} label={t.label} value={t.value} icon={t.icon} />
              ))}
              {avgRating !== null && (
                <Card>
                  <CardContent className="p-4">
                    <p className="text-sm text-muted-foreground">
                      Average rating ({ratings.length} review{ratings.length === 1 ? '' : 's'})
                    </p>
                    <p className="mt-0.5 text-2xl font-semibold">
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
