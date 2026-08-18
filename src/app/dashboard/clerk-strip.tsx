import Link from 'next/link';
import { CalendarDays, ChevronRight, MessageSquare, ShoppingBag } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { StatusPill } from '@/components/status-pill';
import { formatRelativeTime } from '@/lib/relative-time';
import type { ClerkCard } from '@/services/overview';
import { HomeIcon } from '@/components/home-icon';

const STATE_LABEL: Record<ClerkCard['state'], string> = {
  active: 'Active',
  quiet: 'Quiet',
  off: 'Not connected',
};

const STATE_TONE: Record<ClerkCard['state'], 'success' | 'neutral'> = {
  active: 'success',
  quiet: 'neutral',
  off: 'neutral',
};

const STATE_FALLBACK: Record<Exclude<ClerkCard['state'], 'active'>, string> = {
  quiet: 'Ready — nothing to report yet.',
  off: 'Connect a channel to switch this on.',
};

const CLERK_ICON: Record<ClerkCard['key'], { icon: LucideIcon; tone: 'primary' | 'success' }> = {
  replies: { icon: MessageSquare, tone: 'success' },
  orders: { icon: ShoppingBag, tone: 'primary' },
  bookings: { icon: CalendarDays, tone: 'primary' },
};

/**
 * docs/27 §7.5 — never the Home greeting, always a strip below the queue. Each
 * card links straight to the surface it summarizes rather than a detail sheet,
 * since no such component exists yet (same call as the needs-attention rows).
 */
export function ClerkStrip({ cards, now }: { cards: ClerkCard[]; now: number }) {
  return (
    <div>
      <h2 className="mb-2 font-heading text-sm font-semibold">Your clerks</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {cards.map((card) => {
          const { icon, tone } = CLERK_ICON[card.key];
          return (
            <Link
              key={card.key}
              href={card.href}
              className="flex items-center gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-colors hover:ring-foreground/20"
            >
              <HomeIcon icon={icon} tone={tone} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{card.name}</span>
                  <StatusPill tone={STATE_TONE[card.state]}>{STATE_LABEL[card.state]}</StatusPill>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {card.outcome
                    ? `${card.outcome} — ${formatRelativeTime(card.timestamp as string, now)}`
                    : STATE_FALLBACK[card.state as Exclude<ClerkCard['state'], 'active'>]}
                </p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
