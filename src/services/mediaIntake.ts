import 'server-only';
import * as media from './meta/media';
import * as transcribeService from './ai/transcribe';
import * as messages from './messages';
import * as orders from './orders';
import { getTranscriptionKey } from '@/lib/secrets';
import { sanitizeInbound } from './security/sanitize';
import { MAX_MEDIA_PER_SESSION_WINDOW, MEDIA_CAP_WINDOW_MINUTES } from '@/lib/constants';
import type { ChatSession, InboundAttachment, OrderAttachment, Tenant } from '@/types/domain';

/**
 * Turns this turn's raw inbound attachments into persisted media + the extra text/
 * image parts the orchestrator folds into the prompt (docs/10 §4/§5/§6.1). Gated
 * entirely on `tenant.customOrdersEnabled` — this whole feature exists to service
 * custom orders (docs/10 §1 intro); a tenant that hasn't opted in behaves exactly as
 * the doc-09 text-only order-taker (acceptance criterion #1).
 *
 * - image: downloaded + a short-TTL signed URL minted for the multimodal turn.
 *   Skipped when `mediaHandling === 'reject'` (§4.2).
 * - audio (voice note): downloaded + transcribed; the transcript folds into the
 *   turn's text like typed input (§5). NOT gated on `mediaHandling` — a voice note
 *   is spoken text, not a visual "example" the reject directive is about.
 * - video: MVP "persist + ask" (§6.1, H1 frozen) — no decode. Persisted for owner
 *   review; a server-authored note steers the model to ask for a photo instead.
 *   Skipped when `mediaHandling === 'reject'`, same as image.
 */

export interface MediaIntakeResult {
  /** Persisted refs from THIS turn only — threaded onto chat_messages and, if an
   *  order results, server-bound onto the order via ToolContext (docs/10 §4.3). */
  attachments: OrderAttachment[];
  /** Extra text to fold into the user turn: caption, transcript, or a video note. */
  extraText: string | null;
  /** Signed URLs for images downloaded this turn — rides the dynamic user turn only. */
  imageUrls: string[];
}

const EMPTY: MediaIntakeResult = { attachments: [], extraText: null, imageUrls: [] };

export async function processInboundMedia(
  rawAttachments: InboundAttachment[] | undefined,
  tenant: Pick<
    Tenant,
    'id' | 'customOrdersEnabled' | 'mediaHandling' | 'metaTokenSecretId' | 'whatsappTokenSecretId' | 'openaiKeySecretId'
  >,
  session: Pick<ChatSession, 'id' | 'platform'>,
): Promise<MediaIntakeResult> {
  if (!rawAttachments?.length || !tenant.customOrdersEnabled) return EMPTY;

  const used = await messages.countRecentAttachments(session.id, MEDIA_CAP_WINDOW_MINUTES);
  if (used >= MAX_MEDIA_PER_SESSION_WINDOW) {
    return { ...EMPTY, extraText: '[System note: media limit reached for this conversation — continue by text.]' };
  }

  const attachments: OrderAttachment[] = [];
  const imageUrls: string[] = [];
  const textNotes: string[] = [];

  for (const raw of rawAttachments) {
    if (raw.kind === 'image') {
      if (tenant.mediaHandling === 'reject') continue;
      const downloaded = await media.download(raw, tenant, session.id, session.platform);
      if (!downloaded) continue;
      attachments.push({ kind: 'image', storagePath: downloaded.storagePath, mimeType: downloaded.mimeType });

      // K1 (docs/11 §3.3.1 B): proof beats example — a session-scoped, server-decided
      // route, never the model's or the untrusted caption's call. An open unpaid
      // manual-transfer order routes this image as a payment receipt instead of a
      // custom-order example; the vision/example flow is skipped entirely for it.
      const proofTarget = await orders.findProofTarget(session.id);
      if (proofTarget) {
        await orders.attachProof(proofTarget.id, {
          kind: 'image',
          storagePath: downloaded.storagePath,
          mimeType: downloaded.mimeType,
        });
        await orders.setPaymentStatus(proofTarget.id, 'awaiting_verification');
        textNotes.push(
          '[System note: the customer sent a payment receipt/screenshot, recorded as proof of payment for ' +
            `order ${proofTarget.id}. Tell them it was received and the business will verify it shortly — do ` +
            'NOT tell them the payment is confirmed.]',
        );
        continue;
      }

      const signedUrl = await media.getSignedUrl(downloaded.storagePath);
      if (signedUrl) imageUrls.push(signedUrl);
      if (raw.caption?.trim()) textNotes.push(sanitizeInbound(raw.caption));
      continue;
    }

    if (raw.kind === 'audio') {
      const { key } = await getTranscriptionKey(tenant);
      const result = await transcribeService.transcribe(raw, tenant, session.id, session.platform, key);
      if (!result) continue;
      attachments.push({ kind: 'audio', storagePath: result.storagePath, mimeType: result.mimeType });
      textNotes.push(sanitizeInbound(result.transcript));
      continue;
    }

    if (raw.kind === 'video') {
      if (tenant.mediaHandling === 'reject') continue;
      const downloaded = await media.download(raw, tenant, session.id, session.platform);
      if (!downloaded) continue;
      attachments.push({ kind: 'video', storagePath: downloaded.storagePath, mimeType: downloaded.mimeType });
      textNotes.push(
        '[System note: the customer sent a video. Video is not analysed automatically — ask them ' +
          'for a clear photo of the item plus a short description (typed or voice note) instead.]',
      );
      continue;
    }
  }

  return { attachments, extraText: textNotes.length ? textNotes.join('\n') : null, imageUrls };
}
