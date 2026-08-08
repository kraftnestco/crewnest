import Link from 'next/link';
import { StatusPill } from '@/components/status-pill';
import { formatRelativeTime } from '@/lib/relative-time';
import type { CrewCard } from '@/services/overview';

const STATE_LABEL: Record<CrewCard['state'], string> = {
  active: 'Active',
  quiet: 'Quiet',
  off: 'Not connected',
};

const STATE_TONE: Record<CrewCard['state'], 'success' | 'neutral'> = {
  active: 'success',
  quiet: 'neutral',
  off: 'neutral',
};

const STATE_FALLBACK: Record<Exclude<CrewCard['state'], 'active'>, string> = {
  quiet: 'Ready — nothing to report yet.',
  off: 'Connect a channel to switch this on.',
};

/**
 * docs/27 §7.5 — never the Home greeting, always a strip below the queue. Each
 * card links straight to the surface it summarizes rather than a detail sheet,
 * since no such component exists yet (same call as the needs-attention rows).
 */
export function CrewStrip({ cards, now }: { cards: CrewCard[]; now: number }) {
  return (
    <div>
      <h2 className="mb-2 font-heading text-sm font-semibold">Your crew</h2>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {cards.map((card) => (
          <Link
            key={card.key}
            href={card.href}
            className="flex min-w-[220px] flex-1 flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-colors hover:ring-foreground/20"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{card.name}</span>
              <StatusPill tone={STATE_TONE[card.state]}>{STATE_LABEL[card.state]}</StatusPill>
            </div>
            <p className="text-xs text-muted-foreground">
              {card.outcome
                ? `${card.outcome} — ${formatRelativeTime(card.timestamp as string, now)}`
                : STATE_FALLBACK[card.state as Exclude<CrewCard['state'], 'active'>]}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
