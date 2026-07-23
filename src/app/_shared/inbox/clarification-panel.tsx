'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { PendingClarification } from '@/types/domain';

const KIND_LABELS: Record<PendingClarification['kind'], string> = {
  voice_review: 'Voice note needs review',
  video_review: 'Video needs review',
  image_ambiguous: 'Ambiguous photo needs review',
};

/**
 * Consolidated "needs your input" surface for the three human-review cases
 * (voice/video the AI is withholding, or an image it flagged as ambiguous).
 * Purely presentational — `onResolve` is swapped for the real server action
 * once Phase B wires `resolveClarificationAction` in.
 */
export function ClarificationPanel({
  pendingClarification,
  onResolve,
  getAttachmentUrl,
}: {
  pendingClarification: PendingClarification | null | undefined;
  onResolve: (note: string) => void | Promise<void>;
  getAttachmentUrl?: (path: string) => Promise<string | null>;
}) {
  if (!pendingClarification) return null;

  return (
    <ClarificationPanelBody
      key={pendingClarification.raisedAt}
      pendingClarification={pendingClarification}
      onResolve={onResolve}
      getAttachmentUrl={getAttachmentUrl}
    />
  );
}

/** Keyed on `raisedAt` by the parent so a new clarification remounts with fresh `note`/`submitting` state. */
function ClarificationPanelBody({
  pendingClarification,
  onResolve,
  getAttachmentUrl,
}: {
  pendingClarification: PendingClarification;
  onResolve: (note: string) => void | Promise<void>;
  getAttachmentUrl?: (path: string) => Promise<string | null>;
}) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onResolve(trimmed);
      setNote('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
      <p className="mb-2 text-[11px] font-semibold tracking-wide text-amber-600 uppercase dark:text-amber-400">
        {KIND_LABELS[pendingClarification.kind]}
      </p>

      {pendingClarification.attachmentStoragePath && (
        <div className="mb-2.5">
          <ClarificationAttachment
            kind={pendingClarification.kind}
            storagePath={pendingClarification.attachmentStoragePath}
            getAttachmentUrl={getAttachmentUrl}
          />
        </div>
      )}

      {pendingClarification.kind === 'voice_review' && pendingClarification.transcript && (
        <p className="mb-2.5 text-sm italic text-muted-foreground">&ldquo;{pendingClarification.transcript}&rdquo;</p>
      )}

      <p className="mb-2.5 text-sm font-medium">{pendingClarification.question}</p>

      {pendingClarification.options && pendingClarification.options.length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {pendingClarification.options.map((opt) => (
            <button
              key={opt}
              type="button"
              disabled={submitting}
              onClick={() => submit(opt)}
              className="rounded-full border border-input bg-background px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Tell the AI what to say to the customer…"
          rows={2}
          className="resize-none bg-background text-sm"
          disabled={submitting}
        />
        <Button size="sm" className="w-full" disabled={submitting || !note.trim()} onClick={() => submit(note)}>
          {submitting ? 'Sending…' : 'Send answer'}
        </Button>
      </div>
    </div>
  );
}

/** Fetches a short-TTL signed URL for the flagged attachment and renders it by kind. */
function ClarificationAttachment({
  kind,
  storagePath,
  getAttachmentUrl,
}: {
  kind: PendingClarification['kind'];
  storagePath: string;
  getAttachmentUrl?: (path: string) => Promise<string | null>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!getAttachmentUrl) return;
    let active = true;
    getAttachmentUrl(storagePath)
      .then((signedUrl) => {
        if (!active) return;
        if (signedUrl) setUrl(signedUrl);
        else setFailed(true);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [storagePath, getAttachmentUrl]);

  if (!getAttachmentUrl) return null;
  if (failed) return <p className="text-xs italic text-muted-foreground">Media unavailable.</p>;
  if (!url) return <p className="text-xs text-muted-foreground">Loading media…</p>;

  if (kind === 'image_ambiguous') {
    // eslint-disable-next-line @next/next/no-img-element -- signed URL, not an optimizable static asset
    return <img src={url} alt="Flagged customer attachment" className="max-h-48 rounded-lg object-contain" />;
  }
  if (kind === 'video_review') {
    return <video controls src={url} className="max-h-48 w-full rounded-lg" />;
  }
  return <audio controls src={url} className="h-8 w-full" />;
}
