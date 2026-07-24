import Image from 'next/image';
import { ArrowUp, Loader2 } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/**
 * Shared Claude-style chat presentation, factored out of `business-copilot.tsx`
 * so the read-only Admin Copilot (docs/20 Part 2) can reuse the same look
 * without duplicating it. Purely presentational — no copilot-specific logic,
 * no propose/apply concepts (those stay in each copilot's own patch/action UI).
 */

/** KraftNest mark on the CrewNest brand green — used in the header, empty state, and beside every reply. */
export function CopilotAvatar({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const lg = size === 'lg';
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl bg-primary shadow-sm',
        lg ? 'size-11 p-2.5' : 'size-8 p-1.5',
      )}
    >
      <Image
        src="/kraftnest-mark.png"
        alt="CrewAI"
        width={44}
        height={44}
        className="h-full w-full object-contain"
      />
    </span>
  );
}

export function UserMessage({ content }: { content: string }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-1 flex justify-end duration-300 motion-reduce:animate-none">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
        {content}
      </div>
    </div>
  );
}

export function AssistantMessage({ content, children }: { content: string; children?: React.ReactNode }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-1 flex gap-3 duration-300 motion-reduce:animate-none">
      <CopilotAvatar />
      <div className="min-w-0 flex-1 space-y-3 pt-1">
        <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">{content}</p>
        {children}
      </div>
    </div>
  );
}

export function ThinkingRow() {
  return (
    <div className="flex gap-3">
      <CopilotAvatar />
      <div className="flex items-center gap-1 pt-3">
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.3s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.15s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50" />
      </div>
    </div>
  );
}

/**
 * The "keypad" — a floating pill composer docked over the transcript rather
 * than boxed into the layout with a hard border. Mirrors the Ghawas/Khizr
 * home mockup's `.composer-dock`: a gradient-fade backdrop (so it reads as
 * floating above the scroll, not a flush footer) and a rounded pill that lifts
 * slightly on focus.
 *
 * Two positioning modes:
 * - `absolute` (default) — floats over a `relative` inner-scroll transcript,
 *   for the confined full-height chat (the Admin Copilot's dedicated page).
 * - `sticky` — pins to the bottom of the *page* scroll, for the Business
 *   Copilot on the home surface where the whole page scrolls instead of the
 *   chat being trapped in its own little box. Clears the mobile tab bar.
 */
export function ComposerDock({
  value,
  onChange,
  onKeyDown,
  onSend,
  disabled,
  placeholder,
  footer,
  mode = 'absolute',
}: {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  disabled: boolean;
  placeholder: string;
  footer?: ReactNode;
  mode?: 'absolute' | 'sticky';
}) {
  const floating = mode === 'absolute';
  return (
    <div
      className={cn(
        'z-10 bg-gradient-to-t from-card via-card/95 to-transparent px-4 pt-10 pb-4',
        floating ? 'pointer-events-none absolute inset-x-0 bottom-0' : 'sticky bottom-16 lg:bottom-0',
      )}
    >
      <div
        className={cn(
          'mx-auto flex max-w-2xl items-end gap-2 rounded-2xl border border-border/80 bg-background py-1.5 pr-1.5 pl-4 shadow-lg shadow-foreground/10 transition-all duration-150 focus-within:-translate-y-0.5 focus-within:border-primary/40 focus-within:shadow-xl',
          floating && 'pointer-events-auto',
        )}
      >
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={disabled}
          className="max-h-40 min-h-0 flex-1 resize-none border-0 bg-transparent px-0 py-2.5 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
        />
        <Button
          type="button"
          size="icon"
          onClick={onSend}
          disabled={disabled || !value.trim()}
          aria-label="Send"
          className="size-9 shrink-0 rounded-full"
        >
          {disabled ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
        </Button>
      </div>
      {footer && (
        <p
          className={cn(
            'mx-auto mt-2 max-w-2xl px-1 text-center text-[0.7rem] leading-relaxed text-muted-foreground',
            floating && 'pointer-events-none',
          )}
        >
          {footer}
        </p>
      )}
    </div>
  );
}
