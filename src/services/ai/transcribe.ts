import 'server-only';
import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import * as media from '@/services/meta/media';
import type { InboundAttachment, Platform, Tenant } from '@/types/domain';

/**
 * Voice-note transcription (docs/10 §5). Downloads + persists the audio via the F3
 * media service, then transcribes the persisted bytes. Endpoint + key + model are
 * resolved by `lib/secrets.ts#getTranscriptionConfig` — OpenAI's `gpt-4o-transcribe`
 * for OpenAI tenants, or OpenRouter's OpenAI-compatible `/audio/transcriptions`
 * (Whisper) for OpenRouter tenants, so voice works without a funded OpenAI key. The
 * OpenRouter endpoint is reached by pointing the OpenAI SDK at its `baseURL`, exactly
 * like the chat provider. Never throws; a download or transcription failure returns
 * null so the caller can fall back to the customer's typed text (if any).
 */

export interface TranscribeConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
}

export interface TranscribeResult {
  transcript: string;
  storagePath: string;
  mimeType: string;
}

export async function transcribe(
  attachment: InboundAttachment,
  tenant: Pick<Tenant, 'id' | 'metaTokenSecretId' | 'whatsappTokenSecretId'>,
  sessionId: string,
  platform: Platform,
  config: TranscribeConfig,
): Promise<TranscribeResult | null> {
  const downloaded = await media.download(attachment, tenant, sessionId, platform);
  if (!downloaded) return null;

  try {
    const signedUrl = await media.getSignedUrl(downloaded.storagePath);
    if (!signedUrl) return null;

    const audioRes = await fetch(signedUrl);
    if (!audioRes.ok) return null;
    const blob = await audioRes.blob();
    const file = new File([blob], `audio-${randomUUID()}`, { type: downloaded.mimeType });

    const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
    const result = await client.audio.transcriptions.create({ file, model: config.model });

    const transcript = result.text?.trim();
    if (!transcript) return null;

    return { transcript, storagePath: downloaded.storagePath, mimeType: downloaded.mimeType };
  } catch (err) {
    console.warn(`[transcribe] failed (tenant ${tenant.id}):`, err instanceof Error ? err.message : err);
    return null;
  }
}
