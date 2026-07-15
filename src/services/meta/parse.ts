import type { InboundMessage, Platform } from '@/types/domain';

/**
 * Normalise a Meta webhook POST body into InboundMessage[].
 *
 * The three products deliver different envelopes; we flatten them all to the
 * single InboundMessage shape the orchestrator consumes. Phase 1 = TEXT only.
 * We deliberately skip everything that is not an inbound customer text message:
 * delivery/read receipts, message echoes (our own outbound), reactions,
 * attachments, postbacks, and any non-text WhatsApp message type. See
 * docs/06-INTEGRATIONS.md §1.1 for the destination-id → tenant column mapping.
 *
 * Shapes:
 *  - WhatsApp (object 'whatsapp_business_account'):
 *      entry[].changes[].value.messages[]
 *      destination   = entry[].changes[].value.metadata.phone_number_id
 *      from          = messages[].from
 *      providerMsgId = messages[].id
 *      text          = messages[].text.body  (only when type === 'text')
 *      (value.statuses[] are receipts → ignored: we only read value.messages[])
 *  - Messenger (object 'page') & Instagram (object 'instagram'):
 *      entry[].messaging[]
 *      from          = sender.id
 *      providerMsgId = message.mid
 *      text          = message.text
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

    for (const msgRaw of asArray(value.messages)) {
      const msg = asRecord(msgRaw);
      if (!msg || msg.type !== 'text') continue; // Phase 1: text only.

      const text = asString(asRecord(msg.text)?.body);
      const from = asString(msg.from);
      if (!text || !from) continue;

      out.push({
        platform: 'whatsapp',
        destinationId,
        externalUserId: from,
        text,
        providerMsgId: asString(msg.id) ?? undefined,
      });
    }
  }
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
    if (!text) continue; // Attachment-only / reaction / unsupported → skip.

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
      text,
      providerMsgId: asString(message.mid) ?? undefined,
    });
  }
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
