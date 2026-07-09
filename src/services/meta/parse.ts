import type { InboundMessage, Platform } from '@/types/domain';

/**
 * Normalise a Meta webhook POST body into InboundMessage[].
 *
 * ⚠️ [OPUS] checkpoint (docs/07-PHASES.md): Messenger, Instagram, and WhatsApp
 * payload shapes differ. Fill each branch carefully and add fixtures/tests from
 * real webhook samples. Extract a stable providerMsgId per product for dedupe.
 *
 * Shapes (summary):
 *  - WhatsApp:   entry[].changes[].value.messages[] ; destination =
 *                entry[].changes[].value.metadata.phone_number_id ;
 *                from = messages[].from ; id = messages[].id ; text = messages[].text.body
 *  - Messenger:  entry[].messaging[] ; destination = recipient.id (page id) ;
 *                from = sender.id ; id = message.mid ; text = message.text
 *  - Instagram:  entry[].messaging[] (IG) ; destination = entry[].id (IG account) ;
 *                from = sender.id ; id = message.mid ; text = message.text
 */
export function parseMetaWebhook(body: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const payload = body as { object?: string; entry?: unknown[] };
  if (!payload?.entry) return out;

  // TODO(sonnet)[OPUS]: implement per-product extraction into the InboundMessage
  // shape below. Skip non-message events (delivery/read receipts, echoes).
  //
  // Example target push:
  //   out.push({ platform, destinationId, externalUserId, text, providerMsgId });

  return out;
}

/** Map a Meta `object` field / change to our Platform enum. */
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
