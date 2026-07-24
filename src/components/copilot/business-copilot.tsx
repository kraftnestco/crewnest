'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, CalendarClock, Check, Loader2, Plus, Truck, Wand2, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { applyCopilotActionAction, applyCopilotPatchAction, copilotTurnAction } from '@/app/dashboard/business/copilot-actions';
import type { CopilotMessage, CopilotPatch } from '@/services/ai/copilot/tiers';
import { describeCopilotAction, type CopilotAction } from '@/services/ai/copilot/actions';
import { CopilotAvatar, UserMessage, AssistantMessage, ThinkingRow, ComposerDock } from './chat-shell';

/**
 * Business Copilot — the Claude-style chat on the tenant home page (docs/19 O5).
 * The owner types plain language ("add bridal makeup for 15000", "close 24–26 Dec
 * for Eid") and the copilot proposes the exact profile edit as a
 * `ProposedChangeCard`; the owner commits it with one tap. Nothing is saved until
 * Apply. When an `overview` is passed (home page only), it renders the tenant's
 * needs-attention/activity snapshot inside the panel instead of as separate cards
 * on the page — the stats live with the assistant that can act on them.
 *
 * The safety spine lives on the server (propose/apply split in copilot-actions.ts):
 * this component only renders the transcript, sends turns to `copilotTurnAction`,
 * and — on Apply — calls `applyCopilotPatchAction` then `router.refresh()` so the
 * Business-details editor on /dashboard/business reflects the committed change.
 */

export interface CopilotOverview {
  hasActivity: boolean;
  connectedChannels: string[];
  needsAttention: { key: string; label: string; count: number; href: string }[];
  stats: { label: string; value: number }[];
  avgRating: { value: number; count: number } | null;
}

const SUGGESTIONS: { label: string; icon: LucideIcon }[] = [
  { label: 'Add a new service to my catalogue', icon: Plus },
  { label: 'Close for the holidays', icon: CalendarClock },
  { label: 'Change my delivery charges', icon: Truck },
  { label: 'Make my assistant sound more premium', icon: Wand2 },
];

type ProposalStatus = 'pending' | 'applied' | 'dismissed' | 'superseded';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** Present on assistant turns that staged a profile edit. Independent of `action` — a turn may stage both. */
  patch?: CopilotPatch;
  hasMoneyChange?: boolean;
  patchStatus?: ProposalStatus;
  /** Present on assistant turns that staged an imperative action (invite/inventory). */
  action?: CopilotAction;
  actionStatus?: ProposalStatus;
}

export function BusinessCopilot({
  tenantId,
  businessName,
  overview,
}: {
  tenantId: string;
  businessName: string;
  overview?: CopilotOverview;
}) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [applying, setApplying] = useState<{ index: number; kind: 'patch' | 'action' } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Only chase the bottom once a conversation is underway — on the empty home
    // surface this would otherwise auto-scroll the whole page down on load.
    if (turns.length === 0) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, thinking]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || thinking) return;

      // Build the history the server sees from what's on screen, then append the new turn.
      const history: CopilotMessage[] = turns.map((t) => ({ role: t.role, content: t.content }));
      history.push({ role: 'user', content: trimmed });

      setTurns((prev) => [...prev, { role: 'user', content: trimmed }]);
      setInput('');
      setThinking(true);

      try {
        const result = await copilotTurnAction(tenantId, history);
        if (result.error) {
          setTurns((prev) => [...prev, { role: 'assistant', content: result.error as string }]);
          return;
        }
        const stagedPatch = Object.keys(result.patch).length > 0;
        const stagedAction = Boolean(result.action);
        setTurns((prev) => {
          // A fresh proposal supersedes any earlier still-pending one (of the same kind) to avoid stale applies.
          const next = prev.map((t) => ({
            ...t,
            patchStatus: stagedPatch && t.patchStatus === 'pending' ? ('superseded' as const) : t.patchStatus,
            actionStatus: stagedAction && t.actionStatus === 'pending' ? ('superseded' as const) : t.actionStatus,
          }));
          return [
            ...next,
            {
              role: 'assistant',
              content: result.reply,
              ...(stagedPatch
                ? { patch: result.patch, hasMoneyChange: result.hasMoneyChange, patchStatus: 'pending' as const }
                : {}),
              ...(stagedAction ? { action: result.action, actionStatus: 'pending' as const } : {}),
            },
          ];
        });
      } catch {
        setTurns((prev) => [
          ...prev,
          { role: 'assistant', content: 'Something went wrong there. Please try again in a moment.' },
        ]);
      } finally {
        setThinking(false);
      }
    },
    [tenantId, thinking, turns],
  );

  async function apply(index: number, kind: 'patch' | 'action') {
    const turn = turns[index];
    const payload = kind === 'patch' ? turn?.patch : turn?.action;
    if (!payload || applying !== null) return;
    setApplying({ index, kind });
    try {
      const res =
        kind === 'patch'
          ? await applyCopilotPatchAction(tenantId, turn.patch)
          : await applyCopilotActionAction(tenantId, turn.action);
      if (res.success) {
        setTurns((prev) =>
          prev.map((t, i) =>
            i === index ? { ...t, [kind === 'patch' ? 'patchStatus' : 'actionStatus']: 'applied' } : t,
          ),
        );
        toast.success(kind === 'patch' ? 'Change applied. Your assistant is using it now.' : 'Done.');
        router.refresh();
      } else {
        toast.error(res.error ?? "That change couldn't be applied.");
      }
    } catch {
      toast.error("That change couldn't be applied. Please try again.");
    } finally {
      setApplying(null);
    }
  }

  function dismiss(index: number, kind: 'patch' | 'action') {
    setTurns((prev) =>
      prev.map((t, i) => (i === index ? { ...t, [kind === 'patch' ? 'patchStatus' : 'actionStatus']: 'dismissed' } : t)),
    );
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  const isEmpty = turns.length === 0;

  return (
    <div className="flex flex-col rounded-2xl bg-card ring-1 ring-foreground/10">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <CopilotAvatar />
        <div className="min-w-0">
          <p className="font-heading text-sm font-semibold leading-tight">CrewAI</p>
          <p className="truncate text-xs text-muted-foreground">Describe a change in plain words and I&apos;ll draft it for you</p>
        </div>
      </div>

      {overview && <OverviewPanel overview={overview} />}

      {/* Transcript — grows with the page (whole page scrolls; composer is sticky below) */}
      <div className="min-h-[24rem] px-4 pt-6 pb-4">
        {isEmpty ? (
            <div className="flex flex-col items-center gap-5 py-6 text-center">
              <CopilotAvatar size="lg" />
              <div className="space-y-1.5">
                <p className="font-heading text-base font-semibold text-foreground">How can I help with {businessName}?</p>
                <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
                  Tell me what changed and I&apos;ll prepare the exact update for you to approve. Nothing is saved until
                  you tap Apply.
                </p>
              </div>
              <div className="grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map(({ label, icon: Icon }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => send(label)}
                    className="group flex items-center gap-2.5 rounded-xl border border-border bg-background px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5"
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                    <span className="leading-tight">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {turns.map((turn, i) =>
                turn.role === 'user' ? (
                  <UserMessage key={i} content={turn.content} />
                ) : (
                  <AssistantMessage key={i} content={turn.content}>
                    {turn.patch && (
                      <ProposedChangeCard
                        patch={turn.patch}
                        hasMoneyChange={Boolean(turn.hasMoneyChange)}
                        status={turn.patchStatus ?? 'pending'}
                        applying={applying?.index === i && applying.kind === 'patch'}
                        onApply={() => apply(i, 'patch')}
                        onDismiss={() => dismiss(i, 'patch')}
                      />
                    )}
                    {turn.action && (
                      <ProposedActionCard
                        action={turn.action}
                        status={turn.actionStatus ?? 'pending'}
                        applying={applying?.index === i && applying.kind === 'action'}
                        onApply={() => apply(i, 'action')}
                        onDismiss={() => dismiss(i, 'action')}
                      />
                    )}
                  </AssistantMessage>
                ),
              )}
              {thinking && <ThinkingRow />}
            </div>
          )}
          {/* scroll-mb clears the sticky composer so the last reply never lands under it */}
          <div ref={bottomRef} className="scroll-mb-28" />
        </div>

      <ComposerDock
        mode="sticky"
        value={input}
        onChange={setInput}
        onKeyDown={onComposerKeyDown}
        onSend={() => send(input)}
        disabled={thinking}
        placeholder="Tell me what changed…"
        footer="Nothing is saved until you tap Apply. The copilot can't touch billing, your plan, connected accounts, or API keys."
      />
    </div>
  );
}

/**
 * The former standalone home-page stat cards (needs-attention, activity teaser,
 * rating), now folded into the copilot panel itself — the assistant that can act
 * on the business sits right next to the numbers describing it.
 */
function OverviewPanel({ overview }: { overview: CopilotOverview }) {
  if (!overview.hasActivity) {
    return (
      <div className="border-b px-4 py-2.5 text-xs text-muted-foreground">
        {overview.connectedChannels.length > 0
          ? `Live on ${overview.connectedChannels.join(', ')} — no conversations yet.`
          : 'Almost ready — finish channel setup below to go live.'}
      </div>
    );
  }

  const cells: { label: string; value: string | number; muted: boolean; href?: string }[] = [
    ...overview.needsAttention.map((c) => ({ label: c.label, value: c.count, muted: c.count === 0, href: c.href })),
    ...overview.stats.map((s) => ({ label: s.label, value: s.value, muted: false })),
    ...(overview.avgRating
      ? [
          {
            label: `Rating (${overview.avgRating.count})`,
            value: `${overview.avgRating.value.toFixed(1)}★`,
            muted: false,
          },
        ]
      : []),
  ];

  return (
    <div className="border-b px-2 py-2 sm:px-3 sm:py-3">
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        {cells.map((cell) => {
          const inner = (
            <>
              <p
                className={cn(
                  'text-xl font-semibold tabular-nums leading-none',
                  cell.muted ? 'text-muted-foreground/50' : 'text-foreground',
                )}
              >
                {cell.value}
              </p>
              <p className="mt-1.5 truncate text-[0.7rem] leading-tight text-muted-foreground">{cell.label}</p>
            </>
          );
          return cell.href ? (
            <Link
              key={cell.label}
              href={cell.href}
              className="rounded-lg px-3 py-2 transition-colors hover:bg-muted/60"
            >
              {inner}
            </Link>
          ) : (
            <div key={cell.label} className="px-3 py-2">
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ proposed change */

interface PatchLine {
  label: string;
  detail: string;
  /** Render detail in a preserve-whitespace block (catalogue, instructions). */
  block?: boolean;
}

const MEDIA_LABEL: Record<string, string> = {
  match_catalogue: 'Only recognise photos of catalogue items',
  accept_any: 'Accept any photo',
  reject: 'Politely decline photos',
};

const VOICE_LABEL: Record<string, string> = {
  ai_autonomous: 'Assistant answers voice notes itself',
  human_review: 'Hold voice notes for a teammate',
};

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cod: 'Cash on delivery',
  manual_transfer: 'Bank / wallet transfer',
  gateway: 'Online payment gateway',
};

function truncate(text: string, max = 1200): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function describeHours(bh: NonNullable<CopilotPatch['business_hours']>): string {
  const lines: string[] = [];
  const open = (bh.week ?? []).filter((r) => r.open && r.close);
  if (open.length) lines.push(`Open: ${open.map((r) => `${r.day} ${r.open}–${r.close}`).join(', ')}`);
  if (bh.closures?.length) {
    for (const c of bh.closures) {
      const range = c.from === c.to ? c.from : `${c.from} → ${c.to}`;
      lines.push(`Closed: ${range}${c.message ? ` — ${c.message}` : ''}`);
    }
  }
  return lines.join('\n') || 'Hours updated';
}

function describeKnowledge(kb: NonNullable<CopilotPatch['knowledge_base']>): string {
  const parts: string[] = [];
  if (kb.delivery !== undefined) parts.push(`Delivery: ${kb.delivery || '(cleared)'}`);
  if (kb.returns !== undefined) parts.push(`Returns: ${kb.returns || '(cleared)'}`);
  if (kb.location !== undefined) parts.push(`Location: ${kb.location || '(cleared)'}`);
  if (kb.note !== undefined) parts.push(`Note: ${kb.note || '(cleared)'}`);
  if (kb.faq !== undefined) parts.push(`FAQ: ${kb.faq.length} ${kb.faq.length === 1 ? 'entry' : 'entries'}`);
  return parts.join('\n') || 'Business info updated';
}

/** Turn a staged patch into human-readable, non-technical review lines. */
function describePatch(patch: CopilotPatch): PatchLine[] {
  const lines: PatchLine[] = [];
  const p = patch;

  if (p.system_prompt !== undefined)
    lines.push({ label: 'Assistant persona & voice', detail: 'Rewritten to match your request' });
  if (p.catalog_freeform_text !== undefined)
    lines.push({ label: 'Catalogue', detail: truncate(p.catalog_freeform_text) || '(cleared)', block: true });
  if (p.knowledge_base !== undefined)
    lines.push({ label: 'Business info & FAQ', detail: describeKnowledge(p.knowledge_base), block: true });
  if (p.business_hours !== undefined)
    lines.push({ label: 'Opening hours & closures', detail: describeHours(p.business_hours), block: true });
  if (p.timezone !== undefined) lines.push({ label: 'Timezone', detail: p.timezone ?? '(cleared)' });
  if (p.business_type !== undefined)
    lines.push({ label: 'Business type', detail: p.business_type === 'product' ? 'Product / shop' : 'Service / bookings' });
  if (p.booking_link !== undefined) lines.push({ label: 'Booking link', detail: p.booking_link ?? '(removed)' });
  if (p.custom_orders_enabled !== undefined)
    lines.push({ label: 'Custom orders', detail: p.custom_orders_enabled ? 'On' : 'Off' });
  if (p.custom_orders_require_approval !== undefined)
    lines.push({ label: 'Custom orders need your approval', detail: p.custom_orders_require_approval ? 'Yes' : 'No' });
  if (p.custom_order_instructions !== undefined)
    lines.push({ label: 'Custom order instructions', detail: p.custom_order_instructions ?? '(cleared)', block: true });
  if (p.media_handling !== undefined)
    lines.push({ label: 'Photo handling', detail: MEDIA_LABEL[p.media_handling] ?? p.media_handling });
  if (p.voice_handling !== undefined)
    lines.push({ label: 'Voice-note handling', detail: VOICE_LABEL[p.voice_handling] ?? p.voice_handling });

  // Money fields
  if (p.payments_enabled !== undefined)
    lines.push({ label: 'Accept payments', detail: p.payments_enabled ? 'On' : 'Off' });
  if (p.payment_methods !== undefined)
    lines.push({
      label: 'Payment methods',
      detail: p.payment_methods.map((m) => PAYMENT_METHOD_LABEL[m] ?? m).join(', ') || '(none)',
    });
  if (p.payment_instructions !== undefined)
    lines.push({ label: 'Payment instructions', detail: p.payment_instructions ?? '(cleared)', block: true });
  if (p.default_currency !== undefined) lines.push({ label: 'Currency', detail: p.default_currency });
  if (p.prepaid_required !== undefined)
    lines.push({ label: 'Prepayment required', detail: p.prepaid_required ? 'Yes' : 'No' });

  return lines;
}

function ProposedChangeCard({
  patch,
  hasMoneyChange,
  status,
  applying,
  onApply,
  onDismiss,
}: {
  patch: CopilotPatch;
  hasMoneyChange: boolean;
  status: ProposalStatus;
  applying: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const lines = describePatch(patch);
  if (lines.length === 0) return null;

  const settled = status !== 'pending';

  return (
    <div
      className={cn(
        'mt-2 ml-0 overflow-hidden rounded-xl border transition-opacity',
        status === 'applied' ? 'border-primary/40' : 'border-border',
        settled && status !== 'applied' && 'opacity-70',
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3.5 py-2">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Proposed change</p>
        {status === 'applied' && (
          <span className="flex items-center gap-1 text-xs font-medium text-primary">
            <Check className="size-3.5" /> Applied
          </span>
        )}
        {status === 'dismissed' && <span className="text-xs text-muted-foreground">Dismissed</span>}
        {status === 'superseded' && <span className="text-xs text-muted-foreground">Replaced by a newer change</span>}
      </div>

      {hasMoneyChange && (
        <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>This changes how customers pay you, so please double-check it before applying.</span>
        </div>
      )}

      <dl className="divide-y divide-border/70">
        {lines.map((line, i) => (
          <div key={i} className="px-3.5 py-2.5">
            <dt className="text-xs font-medium text-muted-foreground">{line.label}</dt>
            {line.block ? (
              <dd className="mt-1 rounded-md bg-muted/60 px-2.5 py-2 text-sm whitespace-pre-wrap text-foreground">
                {line.detail}
              </dd>
            ) : (
              <dd className="mt-0.5 text-sm text-foreground">{line.detail}</dd>
            )}
          </div>
        ))}
      </dl>

      {!settled && (
        <div className="flex items-center justify-end gap-2 border-t bg-muted/30 px-3.5 py-2.5">
          <Button type="button" variant="ghost" size="sm" onClick={onDismiss} disabled={applying}>
            <X className="size-3.5" /> Dismiss
          </Button>
          <Button type="button" size="sm" onClick={onApply} disabled={applying}>
            {applying ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            {applying ? 'Applying…' : 'Apply'}
          </Button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ proposed action */

function ProposedActionCard({
  action,
  status,
  applying,
  onApply,
  onDismiss,
}: {
  action: CopilotAction;
  status: ProposalStatus;
  applying: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const settled = status !== 'pending';

  return (
    <div
      className={cn(
        'mt-2 ml-0 overflow-hidden rounded-xl border transition-opacity',
        status === 'applied' ? 'border-primary/40' : 'border-border',
        settled && status !== 'applied' && 'opacity-70',
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3.5 py-2">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Proposed action</p>
        {status === 'applied' && (
          <span className="flex items-center gap-1 text-xs font-medium text-primary">
            <Check className="size-3.5" /> Applied
          </span>
        )}
        {status === 'dismissed' && <span className="text-xs text-muted-foreground">Dismissed</span>}
        {status === 'superseded' && <span className="text-xs text-muted-foreground">Replaced by a newer change</span>}
      </div>

      <p className="px-3.5 py-3 text-sm text-foreground">{describeCopilotAction(action)}</p>

      {!settled && (
        <div className="flex items-center justify-end gap-2 border-t bg-muted/30 px-3.5 py-2.5">
          <Button type="button" variant="ghost" size="sm" onClick={onDismiss} disabled={applying}>
            <X className="size-3.5" /> Dismiss
          </Button>
          <Button type="button" size="sm" onClick={onApply} disabled={applying}>
            {applying ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            {applying ? 'Applying…' : 'Apply'}
          </Button>
        </div>
      )}
    </div>
  );
}
