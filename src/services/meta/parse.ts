import type { AttachmentKind, InboundAttachment, InboundMessage, Platform } from '@/types/domain';

/**
 * Normalise a Meta webhook POST body into InboundMessage[].
 *
 * The three products deliver different envelopes; we flatten them all to the
 * single InboundMessage shape the orchestrator consumes. We extract image/
 * audio/video attachments (docs/10 §2.5) alongside any text/caption, and only
 * skip a message when it has NEITHER text NOR a supported attachment —
 * delivery/read receipts, message echoes (our own outbound), reactions,
 * postbacks, and unsupported attachment types (file/template/fallback) are
 * still dropped. Gating attachments on tenant config (customOrdersEnabled /
 * mediaHandling) happens downstream in the orchestrator — this parser is
 * tenant-agnostic. See docs/06-INTEGRATIONS.md §1.1 for the destination-id →
 * tenant column mapping.
 *
 * Shapes:
 *  - WhatsApp (object 'whatsapp_business_account'):
 *      entry[].changes[].value.messages[]
 *      destination   = entry[].changes[].value.metadata.phone_number_id
 *      from          = messages[].from
 *      providerMsgId = messages[].id
 *      text          = messages[].text.body        (type === 'text')
 *      attachment    = messages[].{image,audio,video}.{id, mime_type, caption?}
 *                      (type === 'image'|'audio'|'video'; caption is absent for audio)
 *      customerName  = value.contacts[] (parallel array, matched by wa_id) → profile.name
 *      (value.statuses[] are receipts → ignored: we only read value.messages[])
 *  - Messenger (object 'page') & Instagram (object 'instagram'):
 *      entry[].messaging[]
 *      from          = sender.id
 *      providerMsgId = message.mid
 *      text          = message.text
 *      attachments   = message.attachments[].{type, payload.url}
 *      destination   = recipient.id (page id) for Messenger,
 *                      entry[].id (IG account id) for Instagram
 *      (skip message.is_echo, and events with no `message` object)
 */
export function parseMetaWebhook(body: unknown): InboundMessage[] {
  const payload = asRecord(body);
  if (!payload) return [];

  const platform = metaObjectToPlatform(
    typeof payload.object === 'string' ? payload.object : undefined,
  );
  if (!platform) return [];

  const out: InboundMessage[] = [];
  for (const entryRaw of asArray(payload.entry)) {
    const entry = asRecord(entryRaw);
    if (!entry) continue;

    if (platform === 'whatsapp') {
      parseWhatsAppEntry(entry, out);
    } else {
      // Messenger and Instagram share the entry[].messaging[] envelope.
      parseMessagingEntry(entry, platform, out);
    }
  }
  return out;
}

/** Map a Meta `object` field to our Platform enum. */
export function metaObjectToPlatform(object: string | undefined): Platform | null {
  switch (object) {
    case 'whatsapp_business_account':
      return 'whatsapp';
    case 'page':
      return 'facebook';
    case 'instagram':
      return 'instagram';
    default:
      return null;
  }
}

// --- per-product extraction -------------------------------------------------

function parseWhatsAppEntry(entry: Record<string, unknown>, out: InboundMessage[]): void {
  for (const changeRaw of asArray(entry.changes)) {
    const value = asRecord(asRecord(changeRaw)?.value);
    if (!value) continue;

    // Destination = the business phone-number id the message was sent to.
    const destinationId = asString(asRecord(value.metadata)?.phone_number_id);
    if (!destinationId) continue;

    const namesByWaId = extractWhatsAppContactNames(value.contacts);

    for (const msgRaw of asArray(value.messages)) {
      const msg = asRecord(msgRaw);
      if (!msg) continue;

      const from = asString(msg.from);
      if (!from) continue;

      const type = asString(msg.type);
      const text = type === 'text' ? asString(asRecord(msg.text)?.body) : null;
      const attachments = extractWhatsAppAttachment(msg, type);

      if (!text && !attachments) continue; // Neither text nor a supported attachment.

      out.push({
        platform: 'whatsapp',
        destinationId,
        externalUserId: from,
        customerName: namesByWaId.get(from) ?? null,
        text: text ?? '',
        attachments,
        providerMsgId: asString(msg.id) ?? undefined,
      });
    }
  }
}

/** `value.contacts[]` is a parallel array (not indexed to `messages[]`) — build a wa_id → name lookup. */
function extractWhatsAppContactNames(value: unknown): Map<string, string> {
  const out = new Map<string, string>();
  for (const contactRaw of asArray(value)) {
    const contact = asRecord(contactRaw);
    if (!contact) continue;

    const waId = asString(contact.wa_id);
    const name = asString(asRecord(contact.profile)?.name);
    if (waId && name) out.set(waId, name);
  }
  return out;
}

/** WhatsApp media messages nest the descriptor under a key named after `type` itself. */
function extractWhatsAppAttachment(
  msg: Record<string, unknown>,
  type: string | null,
): InboundAttachment[] | undefined {
  const kind = mapAttachmentKind(type);
  if (!kind) return undefined;

  const media = asRecord(msg[kind]);
  const mediaId = asString(media?.id);
  if (!media || !mediaId) return undefined;

  return [
    {
      kind,
      mediaId,
      mimeType: asString(media.mime_type) ?? undefined,
      caption: asString(media.caption) ?? undefined,
    },
  ];
}

function parseMessagingEntry(
  entry: Record<string, unknown>,
  platform: Platform,
  out: InboundMessage[],
): void {
  const entryId = asString(entry.id);

  for (const eventRaw of asArray(entry.messaging)) {
    const event = asRecord(eventRaw);
    if (!event) continue;

    const message = asRecord(event.message);
    if (!message) continue; // Not a message event (delivery/read/postback/etc.).
    if (message.is_echo === true) continue; // Our own outbound, echoed back.

    const text = asString(message.text);
    const attachments = extractMessagingAttachments(message.attachments);
    if (!text && !attachments) continue; // Reaction / unsupported attachment / empty → skip.

    const from = asString(asRecord(event.sender)?.id);
    if (!from) continue;

    // Messenger routes by the page id (recipient.id); Instagram by the IG
    // account id, which is the entry id.
    const destinationId =
      platform === 'instagram' ? entryId : asString(asRecord(event.recipient)?.id);
    if (!destinationId) continue;

    out.push({
      platform,
      destinationId,
      externalUserId: from,
      text: text ?? '',
      attachments,
      providerMsgId: asString(message.mid) ?? undefined,
    });
  }
}

/** Messenger/IG attachments carry a time-limited CDN url directly in the payload — no token fetch. */
function extractMessagingAttachments(value: unknown): InboundAttachment[] | undefined {
  const items = asArray(value);
  if (items.length === 0) return undefined;

  const out: InboundAttachment[] = [];
  for (const itemRaw of items) {
    const item = asRecord(itemRaw);
    if (!item) continue;

    const kind = mapAttachmentKind(asString(item.type));
    if (!kind) continue; // 'file' / 'template' / 'fallback' / etc. → unsupported, skip.

    const url = asString(asRecord(item.payload)?.url);
    if (!url) continue;

    out.push({ kind, url });
  }
  return out.length > 0 ? out : undefined;
}

/** Shared by both channels — WhatsApp's `type` and Messenger/IG's `attachments[].type` use the same strings. */
function mapAttachmentKind(type: string | null): AttachmentKind | null {
  return type === 'image' || type === 'audio' || type === 'video' ? type : null;
}

// --- safe narrowing helpers (webhook bodies are untrusted `unknown`) --------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
