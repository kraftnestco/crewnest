import 'server-only';
import * as media from './meta/media';
import * as transcribeService from './ai/transcribe';
import * as messages from './messages';
import * as orders from './orders';
import { notifyBoth } from '@/services/notifications';
import { getTranscriptionKey } from '@/lib/secrets';
import { sanitizeInbound } from './security/sanitize';
import { MAX_MEDIA_PER_SESSION_WINDOW, MEDIA_CAP_WINDOW_MINUTES } from '@/lib/constants';
import type { ChatSession, InboundAttachment, OrderAttachment, Tenant } from '@/types/domain';

/**
 * Turns this turn's raw inbound attachments into persisted media + the extra text/
 * image parts the orchestrator folds into the prompt (docs/10 §4/§5/§6.1, docs/11
 * §3.3.1 B). Entry gate is `customOrdersEnabled OR paymentsEnabled` — NOT
 * `customOrdersEnabled` alone (fixed 2026-07-20; a payments-only tenant used to
 * never reach the proof-routing check below at all).
 *
 * - image: always downloaded + checked against `orders.findProofTarget` first
 *   (payment-proof routing, gated only on `paymentsEnabled`, independent of custom
 *   orders). Only once that comes back empty does the CUSTOM-ORDERS-only "vision
 *   example" path run — gated on `customOrdersEnabled` and skipped when
 *   `mediaHandling === 'reject'` (§4.2).
 * - audio (voice note) / video: doc-10 custom-order media only, still gated on
 *   `customOrdersEnabled` — a payments-only tenant's voice notes/videos are left
 *   untouched (not part of the payment-proof feature).
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
    | 'id'
    | 'customOrdersEnabled'
    | 'paymentsEnabled'
    | 'mediaHandling'
    | 'metaTokenSecretId'
    | 'whatsappTokenSecretId'
    | 'openaiKeySecretId'
  >,
  session: Pick<ChatSession, 'id' | 'platform'>,
): Promise<MediaIntakeResult> {
  if (!rawAttachments?.length) return EMPTY;
  if (!tenant.customOrdersEnabled && !tenant.paymentsEnabled) return EMPTY;

  const used = await messages.countRecentAttachments(session.id, MEDIA_CAP_WINDOW_MINUTES);
  if (used >= MAX_MEDIA_PER_SESSION_WINDOW) {
    return { ...EMPTY, extraText: '[System note: media limit reached for this conversation — continue by text.]' };
  }

  const attachments: OrderAttachment[] = [];
  const imageUrls: string[] = [];
  const textNotes: string[] = [];

  for (const raw of rawAttachments) {
    if (raw.kind === 'image') {
      const downloaded = await media.download(raw, tenant, session.id, session.platform);
      if (!downloaded) {
        textNotes.push(
          '[System note: the customer sent an image but it failed to download — tell them it didn\'t come ' +
            'through and ask them to resend it.]',
        );
        continue;
      }
      attachments.push({ kind: 'image', storagePath: downloaded.storagePath, mimeType: downloaded.mimeType });

      // K1 (docs/11 §3.3.1 B): proof beats example — a session-scoped, server-decided
      // route, never the model's or the untrusted caption's call. Checked BEFORE the
      // customOrdersEnabled/mediaHandling gate below so a payments-only tenant (no
      // custom orders) still gets its payment proofs routed correctly.
      const proofTarget = await orders.findProofTarget(session.id);
      if (proofTarget) {
        await orders.attachProof(proofTarget.id, {
          kind: 'image',
          storagePath: downloaded.storagePath,
          mimeType: downloaded.mimeType,
        });
        await orders.setPaymentStatus(proofTarget.id, 'awaiting_verification');
        await notifyBoth({
          tenantId: proofTarget.tenantId,
          type: 'payment_proof',
          entityType: 'order',
          entityId: proofTarget.id,
          agency: {
            title: 'Payment proof received',
            body: `Order ${proofTarget.id} — awaiting verification`,
            link: '/admin/orders',
          },
          tenant: {
            title: 'Payment proof received',
            body: 'A customer sent proof of payment — please verify it',
            link: '/dashboard/orders',
          },
        });
        textNotes.push(
          '[System note: the customer sent a payment receipt/screenshot, recorded as proof of payment for ' +
            `order ${proofTarget.id}. Tell them it was received and the business will verify it shortly — do ` +
            'NOT tell them the payment is confirmed.]',
        );
        continue;
      }

      // Not a payment proof — only a custom-orders tenant treats an image as a
      // vision example; a payments-only tenant's non-proof images are persisted
      // above (for the inbox/order-history record) but otherwise left alone.
      if (!tenant.customOrdersEnabled || tenant.mediaHandling === 'reject') continue;

      const signedUrl = await media.getSignedUrl(downloaded.storagePath);
      if (signedUrl) imageUrls.push(signedUrl);
      if (raw.caption?.trim()) textNotes.push(sanitizeInbound(raw.caption));
      continue;
    }

    if (raw.kind === 'audio') {
      if (!tenant.customOrdersEnabled) continue;
      const { key } = await getTranscriptionKey(tenant);
      const result = await transcribeService.transcribe(raw, tenant, session.id, session.platform, key);
      if (!result) {
        textNotes.push(
          '[System note: the customer sent a voice note but it could not be transcribed — tell them it ' +
            "didn't come through and ask them to resend it or type their message.]",
        );
        continue;
      }
      attachments.push({ kind: 'audio', storagePath: result.storagePath, mimeType: result.mimeType });
      textNotes.push(sanitizeInbound(result.transcript));
      continue;
    }

    if (raw.kind === 'video') {
      if (!tenant.customOrdersEnabled || tenant.mediaHandling === 'reject') continue;
      const downloaded = await media.download(raw, tenant, session.id, session.platform);
      if (!downloaded) {
        textNotes.push(
          '[System note: the customer sent a video but it failed to download — tell them it didn\'t come ' +
            'through and ask them to resend it.]',
        );
        continue;
      }
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
