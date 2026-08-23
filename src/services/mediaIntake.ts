import 'server-only';
import * as media from './meta/media';
import * as transcribeService from './ai/transcribe';
import * as messages from './messages';
import * as orders from './orders';
import * as sessions from './sessions';
import { notifyBoth } from '@/services/notifications';
import { getTranscriptionConfig } from '@/lib/secrets';
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
    | 'businessName'
    | 'customOrdersEnabled'
    | 'paymentsEnabled'
    | 'mediaHandling'
    | 'voiceHandling'
    | 'llmProvider'
    | 'metaTokenSecretId'
    | 'whatsappTokenSecretId'
    | 'instagramTokenSecretId'
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
      const downloaded = await media.download(raw, tenant, session.id, session.platform);
      if (!downloaded) {
        textNotes.push(
          '[System note: the customer sent a voice note but it failed to download — tell them it ' +
            "didn't come through and ask them to resend it or type their message.]",
        );
        continue;
      }
      attachments.push({ kind: 'audio', storagePath: downloaded.storagePath, mimeType: downloaded.mimeType });

      // Transcription is BEST-EFFORT and needs a funded OpenAI/OpenRouter account (OpenRouter
      // 402s for audio below a small balance; the master OpenAI key is a placeholder in prod).
      // A null transcript must NOT break the human-review flow below — the human can just play
      // the audio in the clarification panel.
      const transcriptionConfig = await getTranscriptionConfig(tenant);
      const transcript = await transcribeService.transcribeStoragePath(
        downloaded.storagePath,
        downloaded.mimeType,
        transcriptionConfig,
      );

      if (tenant.voiceHandling === 'ai_autonomous') {
        // Autonomous mode genuinely needs the words — without a transcript, ask them to type.
        textNotes.push(
          transcript
            ? sanitizeInbound(transcript)
            : '[System note: the customer sent a voice note but it could not be transcribed — tell them it ' +
                "didn't come through and ask them to resend it or type their message.]",
        );
        continue;
      }

      // human_review (default, docs: media-handoff plan B6) — always hold for a human, with or
      // without a transcript. The transcript (when available) enriches the clarification panel
      // but is never fed to the model as answerable content.
      textNotes.push(
        '[System note: the customer sent a voice note. Do not answer its content — give them one brief, ' +
          "natural holding reply (e.g. that you're checking on it), nothing about its content specifically.]",
      );
      await sessions.setPendingClarification(session.id, {
        kind: 'voice_review',
        question: 'Review this voice note',
        transcript: transcript ?? undefined,
        attachmentStoragePath: downloaded.storagePath,
        raisedAt: new Date().toISOString(),
      });
      await sessions.setHandoff(session.id, true, 'media_review');
      await notifyBoth({
        tenantId: tenant.id,
        type: 'media_review',
        entityType: 'session',
        entityId: session.id,
        agency: {
          title: 'Voice note needs review',
          body: `${tenant.businessName} — a customer sent a voice note`,
          link: `/admin/chat?session=${session.id}`,
        },
        tenant: {
          title: 'A voice note needs your input',
          body: 'A customer sent a voice note — review and reply.',
          link: `/dashboard/chat?session=${session.id}`,
        },
      });
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

      // No autonomous video-interpretation capability exists (docs: media-handoff plan B6) —
      // always hold for a human, same treatment as audio's human_review branch.
      textNotes.push(
        '[System note: the customer sent a video. Do not answer its content — give them one brief, natural ' +
          "holding reply (e.g. that you're checking on it), nothing about its content specifically.]",
      );
      await sessions.setPendingClarification(session.id, {
        kind: 'video_review',
        question: 'Review this video',
        attachmentStoragePath: downloaded.storagePath,
        raisedAt: new Date().toISOString(),
      });
      await sessions.setHandoff(session.id, true, 'media_review');
      await notifyBoth({
        tenantId: tenant.id,
        type: 'media_review',
        entityType: 'session',
        entityId: session.id,
        agency: {
          title: 'Video needs review',
          body: `${tenant.businessName} — a customer sent a video`,
          link: `/admin/chat?session=${session.id}`,
        },
        tenant: {
          title: 'A video needs your input',
          body: 'A customer sent a video — review and reply.',
          link: `/dashboard/chat?session=${session.id}`,
        },
      });
      continue;
    }
  }

  return { attachments, extraText: textNotes.length ? textNotes.join('\n') : null, imageUrls };
}

/**
 * Cross-turn image memory: mint a signed URL for the single most recent image the
 * customer shared within `windowMinutes`, so a later reference ("the picture I sent
 * you") on a turn that carries no new image can still be shown to a vision model.
 * Images otherwise ride only the turn they arrive on (the prompt-cache contract), and
 * `messages.loadWindow` carries text only. Gated exactly like the vision-example path
 * (custom-orders tenant, media not rejected); returns null when there's nothing recent.
 */
export async function getRecentImageUrl(
  session: Pick<ChatSession, 'id'>,
  tenant: Pick<Tenant, 'customOrdersEnabled' | 'mediaHandling'>,
  windowMinutes: number,
): Promise<string | null> {
  if (!tenant.customOrdersEnabled || tenant.mediaHandling === 'reject') return null;
  const storagePath = await messages.getRecentImageStoragePath(session.id, windowMinutes);
  if (!storagePath) return null;
  return media.getSignedUrl(storagePath);
}
