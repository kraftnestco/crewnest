'use client';

import { useState } from 'react';
import { Sparkles, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  TONE_OPTIONS,
  type GenerateSystemPromptResult,
  type PromptArchitectFields,
} from '@/components/intake/intake-shared';

/**
 * Prompt Architect UI (docs/19 O1) — shared by the tenant self-service wizard and
 * the agency intake editor. The owner answers a couple of friendly questions and
 * we compose the assistant's persona for them; the raw prompt is tucked behind an
 * "advanced" toggle so non-technical clients never have to face a blank
 * "You are the AI assistant for…" box.
 *
 * The parent always owns the `system_prompt` value (`systemPrompt`/`onSystemPromptChange`)
 * so it can submit it however it already does. When `onGenerate` is absent (the
 * public demo, which has no tenant/LLM key), this degrades to the plain textarea —
 * identical to the pre-O1 behaviour.
 */
export function PromptArchitect({
  systemPrompt,
  onSystemPromptChange,
  businessType,
  catalogueHint,
  onGenerate,
}: {
  systemPrompt: string;
  onSystemPromptChange: (value: string) => void;
  businessType: string;
  catalogueHint?: string;
  onGenerate?: (fields: PromptArchitectFields) => Promise<GenerateSystemPromptResult>;
}) {
  const [businessSummary, setBusinessSummary] = useState('');
  const [tone, setTone] = useState('friendly');
  const [boundaries, setBoundaries] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(Boolean(systemPrompt.trim()));

  // Demo / no-tenant path: keep the original plain textarea exactly as before.
  if (!onGenerate) {
    return (
      <Textarea
        rows={5}
        value={systemPrompt}
        onChange={(e) => onSystemPromptChange(e.target.value)}
        placeholder="You are the AI assistant for…"
      />
    );
  }

  const hasPrompt = Boolean(systemPrompt.trim());

  async function handleGenerate() {
    if (!onGenerate) return;
    setGenerating(true);
    setGenError(null);
    try {
      const res = await onGenerate({ businessSummary, tone, boundaries, businessType, catalogueHint });
      if (res.prompt) {
        onSystemPromptChange(res.prompt);
        setShowAdvanced(true);
      } else {
        setGenError(res.error ?? 'Could not write the instructions — please try again.');
      }
    } catch {
      setGenError('Could not write the instructions — please try again.');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="business_summary">In one line, what does your business do?</Label>
        <Input
          id="business_summary"
          value={businessSummary}
          onChange={(e) => setBusinessSummary(e.target.value)}
          placeholder="e.g. We bake custom cakes for birthdays and weddings in Karachi"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>How should your assistant sound?</Label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {TONE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTone(opt.value)}
              className={`flex flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors ${
                tone === opt.value ? 'border-primary bg-primary/5' : 'border-input'
              }`}
            >
              <span className="text-sm font-medium">{opt.label}</span>
              <span className="text-xs text-muted-foreground">{opt.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="prompt_boundaries">Anything it should always or never do? (optional)</Label>
        <Textarea
          id="prompt_boundaries"
          rows={2}
          value={boundaries}
          onChange={(e) => setBoundaries(e.target.value)}
          placeholder="e.g. Never promise same-day delivery. Always mention we're a small family business."
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant={hasPrompt ? 'outline' : 'default'} onClick={handleGenerate} disabled={generating}>
          <Sparkles className="size-4" />
          {generating ? 'Writing…' : hasPrompt ? 'Rewrite instructions' : "Write my assistant's instructions"}
        </Button>
        {hasPrompt && !generating && (
          <span className="text-xs text-muted-foreground">Written — review it below, or tweak the wording anytime.</span>
        )}
      </div>

      {genError && <p className="text-sm text-destructive">{genError}</p>}

      <div className="rounded-lg border border-input">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium"
        >
          <span>Advanced — edit the instructions directly</span>
          <ChevronDown className={`size-4 text-muted-foreground transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
        </button>
        {showAdvanced && (
          <div className="border-t border-input p-3">
            <Textarea
              rows={8}
              value={systemPrompt}
              onChange={(e) => onSystemPromptChange(e.target.value)}
              placeholder="You are the AI assistant for…"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              These are the exact instructions your assistant follows. Your catalogue, hours, and payment details are
              added automatically — you don&apos;t need to repeat them here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
