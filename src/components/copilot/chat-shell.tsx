import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Shared Claude-style chat presentation, factored out of `business-copilot.tsx`
 * so the read-only Admin Copilot (docs/20 Part 2) can reuse the same look
 * without duplicating it. Purely presentational — no copilot-specific logic,
 * no propose/apply concepts (those stay in each copilot's own patch/action UI).
 */

/** Gradient sparkle mark used in the header, empty state, and beside every reply. */
export function CopilotAvatar({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const lg = size === 'lg';
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-sm',
        lg ? 'size-11' : 'size-8',
      )}
    >
      <Sparkles className={lg ? 'size-5' : 'size-4'} />
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
