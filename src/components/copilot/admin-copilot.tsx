'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, TrendingDown, Truck, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { adminCopilotTurnAction, applyAdminCopilotActionAction } from '@/app/admin/copilot-actions';
import type { CopilotMessage } from '@/services/ai/copilot/tiers';
import type { CopilotAction } from '@/services/ai/copilot/actions';
import { CopilotAvatar, UserMessage, AssistantMessage, ThinkingRow, ComposerDock } from './chat-shell';
import { ProposedActionCard } from './business-copilot';

/**
 * Admin Copilot — the Claude-style chat for the agency operator (docs/20 Part 2,
 * extended per HANDOFF-followups-admin.md item 2). Mostly advisory: the operator
 * asks about clients or customers by name and the server-side loop
 * (`adminCopilotTurnAction`) answers from a pre-built snapshot plus two
 * read-only lookup tools. It can ALSO propose one of three actions on a NAMED
 * client — invite a teammate, set stock, restock — reusing the exact
 * propose/apply/card spine the Business Copilot uses (`ProposedActionCard`):
 * nothing writes until the operator taps Apply, which calls
 * `applyAdminCopilotActionAction` (the only writer in this path).
 */

const SUGGESTIONS: { label: string; icon: LucideIcon }[] = [
  { label: 'Which clients need attention right now?', icon: TrendingDown },
  { label: 'Any delivery failures today?', icon: Truck },
  { label: 'Look up a client by name', icon: Search },
  { label: "Find a customer's order status", icon: Users },
];

type ProposalStatus = 'pending' | 'applied' | 'dismissed' | 'superseded';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** Present on assistant turns that staged an action targeting a named client. */
  staged?: { action: CopilotAction; tenantId: string; businessName: string };
  actionStatus?: ProposalStatus;
}

export function AdminCopilot() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [applying, setApplying] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, thinking]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || thinking) return;

      const history: CopilotMessage[] = turns.map((t) => ({ role: t.role, content: t.content }));
      history.push({ role: 'user', content: trimmed });

      setTurns((prev) => [...prev, { role: 'user', content: trimmed }]);
      setInput('');
      setThinking(true);

      try {
        const result = await adminCopilotTurnAction(history);
        if (result.error) {
          setTurns((prev) => [...prev, { role: 'assistant', content: result.error as string }]);
          return;
        }
        setTurns((prev) => {
          // A fresh proposal supersedes any earlier still-pending one, same rule as the Business Copilot.
          const next = prev.map((t) => ({
            ...t,
            actionStatus: result.staged && t.actionStatus === 'pending' ? ('superseded' as const) : t.actionStatus,
          }));
          return [
            ...next,
            {
              role: 'assistant',
              content: result.reply,
              ...(result.staged ? { staged: result.staged, actionStatus: 'pending' as const } : {}),
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
    [thinking, turns],
  );

  async function apply(index: number) {
    const turn = turns[index];
    if (!turn?.staged || applying !== null) return;
    setApplying(index);
    try {
      const res = await applyAdminCopilotActionAction(turn.staged.tenantId, turn.staged.action);
      if (res.success) {
        setTurns((prev) => prev.map((t, i) => (i === index ? { ...t, actionStatus: 'applied' } : t)));
        toast.success('Done.');
      } else {
        toast.error(res.error ?? "That action couldn't be applied.");
      }
    } catch {
      toast.error("That action couldn't be applied. Please try again.");
    } finally {
      setApplying(null);
    }
  }

  function dismiss(index: number) {
    setTurns((prev) => prev.map((t, i) => (i === index ? { ...t, actionStatus: 'dismissed' } : t)));
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  const isEmpty = turns.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <CopilotAvatar />
        <div className="min-w-0">
          <p className="font-heading text-sm font-semibold leading-tight">ClerkAI</p>
          <p className="truncate text-xs text-muted-foreground">Ask about any client or customer across the agency</p>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div className="h-full overflow-y-auto px-4 pt-5 pb-32">
          {isEmpty ? (
            <div className="flex flex-col items-center gap-5 py-6 text-center">
              <CopilotAvatar size="lg" />
              <div className="space-y-1.5">
                <p className="font-heading text-base font-semibold text-foreground">What do you want to check on?</p>
                <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
                  I can triage what needs attention, pull up a specific client or customer by name, or prepare an
                  invite/restock for a named client — you approve every change before it happens.
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
                    {turn.staged && (
                      <ProposedActionCard
                        action={turn.staged.action}
                        status={turn.actionStatus ?? 'pending'}
                        applying={applying === i}
                        onApply={() => apply(i)}
                        onDismiss={() => dismiss(i)}
                        targetLabel={`For ${turn.staged.businessName}`}
                      />
                    )}
                  </AssistantMessage>
                ),
              )}
              {thinking && <ThinkingRow />}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <ComposerDock
          value={input}
          onChange={setInput}
          onKeyDown={onComposerKeyDown}
          onSend={() => send(input)}
          disabled={thinking}
          placeholder="Ask about a client or customer…"
          footer="I can propose an invite or stock change for a client — nothing happens until you tap Apply. I can't touch billing, plans, models, or message customers."
        />
      </div>
    </div>
  );
}
