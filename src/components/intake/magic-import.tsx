'use client';

import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { MagicImportFields, MagicImportResult } from '@/components/intake/intake-shared';

/**
 * Magic Import (docs/19 O2). Paste a website/social link → the server reads it and
 * returns a draft profile that the caller overlays onto the intake wizard for a
 * one-click confirm. Presentational + a single action call; never persists.
 */
export function MagicImport({
  action,
  onImported,
}: {
  action: (url: string) => Promise<MagicImportResult>;
  onImported: (fields: MagicImportFields, summary: string) => void;
}) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const trimmed = url.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await action(trimmed);
      if (res.fields) {
        onImported(res.fields, res.summary ?? '');
        setUrl('');
      } else {
        setError(res.error ?? "We couldn't read that link.");
      }
    } catch {
      setError("We couldn't read that link — check it opens in a browser, or fill in the steps yourself.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <p className="text-sm font-medium">Set up from your website or socials</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Paste your website, Facebook, or Instagram page link and we&apos;ll read it and fill in the steps below for you.
        You review everything before it&apos;s saved.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              run();
            }
          }}
          placeholder="https://instagram.com/yourbusiness"
          disabled={loading}
        />
        <Button type="button" onClick={run} disabled={loading || !url.trim()} className="shrink-0">
          {loading ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Reading…
            </>
          ) : (
            'Import'
          )}
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
