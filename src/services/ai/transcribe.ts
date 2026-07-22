import 'server-only';
import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import * as media from '@/services/meta/media';

/**
 * Voice-note transcription (docs/10 §5). Transcribes an ALREADY-DOWNLOADED audio object
 * (mediaIntake downloads + persists it first, so the attachment/human-review flow never
 * depends on transcription succeeding). Endpoint + key + model come from
 * `lib/secrets.ts#getTranscriptionConfig` — OpenAI's `gpt-4o-transcribe` for OpenAI
 * tenants, or OpenRouter's OpenAI-compatible `/audio/transcriptions` (Whisper) for
 * OpenRouter tenants (reached by pointing the OpenAI SDK at its `baseURL`).
 *
 * Best-effort: NEVER throws, returns null on any failure so the caller degrades. Note
 * OpenRouter returns HTTP 402 for audio below a small account balance (~$0.50), and the
 * master OpenAI key is a placeholder in prod — so on an unfunded setup this returns null
 * and the human-review path proceeds with just the audio (no transcript).
 */

export interface TranscribeConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
}

export async function transcribeStoragePath(
  storagePath: string,
  mimeType: string,
  config: TranscribeConfig,
): Promise<string | null> {
  try {
    const signedUrl = await media.getSignedUrl(storagePath);
    if (!signedUrl) return null;

    const audioRes = await fetch(signedUrl);
    if (!audioRes.ok) return null;
    const blob = await audioRes.blob();
    const file = new File([blob], `audio-${randomUUID()}`, { type: mimeType });

    const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
    const result = await client.audio.transcriptions.create({ file, model: config.model });

    return result.text?.trim() || null;
  } catch (err) {
    console.warn(`[transcribe] failed (model ${config.model}):`, err instanceof Error ? err.message : err);
    return null;
  }
}
