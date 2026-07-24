'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Loader2, Search, TrendingDown, Truck, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { adminCopilotTurnAction } from '@/app/admin/copilot-actions';
import type { CopilotMessage } from '@/services/ai/copilot/tiers';
import { CopilotAvatar, UserMessage, AssistantMessage, ThinkingRow } from './chat-shell';

/**
 * Admin Copilot — the Claude-style chat for the agency operator (docs/20 Part 2).
 * Unlike the Business Copilot, this is ADVISORY ONLY: there is no propose/apply
 * split, no cards, no writes anywhere in the path — every reply is plain prose.
 * The operator asks about clients or customers by name; the server-side loop
 * (`adminCopilotTurnAction`) answers from a pre-built snapshot plus two
 * read-only lookup tools (`lookup_tenant`, `lookup_customer`).
 */

const SUGGESTIONS: { label: string; icon: LucideIcon }[] = [
  { label: 'Which clients need attention right now?', icon: TrendingDown },
  { label: 'Any delivery failures today?', icon: Truck },
  { label: 'Look up a client by name', icon: Search },
  { label: "Find a customer's order status", icon: Users },
];

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

export function AdminCopilot() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
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
        setTurns((prev) => [
          ...prev,
          { role: 'assistant', content: result.error ? result.error : result.reply },
        ]);
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

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  const isEmpty = turns.length === 0;

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <CopilotAvatar />
        <div className="min-w-0">
          <p className="font-heading text-sm font-semibold leading-tight">Admin Copilot</p>
          <p className="truncate text-xs text-muted-foreground">Ask about any client or customer across the agency</p>
        </div>
      </div>

      <div className="max-h-[32rem] min-h-[12rem] overflow-y-auto px-4 py-5">
        {isEmpty ? (
          <div className="flex flex-col items-center gap-5 py-6 text-center">
            <CopilotAvatar size="lg" />
            <div className="space-y-1.5">
              <p className="font-heading text-base font-semibold text-foreground">What do you want to check on?</p>
              <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
                I can triage what needs attention, or pull up a specific client or customer by name. I can&apos;t
                change anything — just look things up.
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
                <AssistantMessage key={i} content={turn.content} />
              ),
            )}
            {thinking && <ThinkingRow />}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t p-3">
        <div className="flex items-end gap-2 rounded-2xl border border-input bg-background px-3 py-2 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onComposerKeyDown}
            placeholder="Ask about a client or customer…"
            rows={1}
            disabled={thinking}
            className="max-h-40 min-h-0 flex-1 resize-none border-0 bg-transparent px-0 py-1 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
          />
          <Button
            type="button"
            size="icon"
            onClick={() => send(input)}
            disabled={thinking || !input.trim()}
            aria-label="Send"
            className="size-8 shrink-0 rounded-full"
          >
            {thinking ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </Button>
        </div>
        <p className="mt-2 px-1 text-[0.7rem] leading-relaxed text-muted-foreground">
          Advisory only — I can&apos;t change settings, message customers, or take any action.
        </p>
      </div>
    </div>
  );
}
