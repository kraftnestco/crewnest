/**
 * Hand-written domain types shared across services. These mirror the SQL enums
 * and the columns the app logic actually uses (a stable façade over the
 * generated database.ts). See docs/03-DATABASE.md.
 */

export type Platform = 'whatsapp' | 'facebook' | 'instagram' | 'web' | 'voice';
/** Live Inbox alert signal — set by the orchestrator from a control token the assistant appends to a reply (docs/08 GUARDRAIL_RULES), mirrors HUMAN_HANDOFF_TOKEN's pattern. Null = no active alert. */
export type AlertSignal = 'frustrated' | 'price_objection' | 'product_doubt' | 'cancellation_risk';
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';
export type MemberRole = 'platform_admin' | 'tenant_admin' | 'tenant_agent';
export type OrderStatus = 'pending' | 'confirmed' | 'cancelled' | 'fulfilled';
/** The fulfilment lifecycle's money counterpart — an ORTHOGONAL axis, never conflated (docs/11 §1.1). */
export type PaymentStatus = 'unpaid' | 'awaiting_verification' | 'paid' | 'refunded' | 'failed';
export type PaymentMethod = 'cod' | 'manual_transfer' | 'gateway';
/** How the assistant should treat a customer-sent example (photo/voice/video) of an item. See docs/10 §3.1. */
export type MediaHandling = 'match_catalogue' | 'accept_any' | 'reject';
/** Product vs service framing — picks which flow block (ORDER_FLOW vs SERVICE_FLOW) the prompt shows. */
export type BusinessType = 'product' | 'service';

/** The subset of a tenant needed to answer a message. */
export interface Tenant {
  id: string;
  businessName: string;
  slug: string | null;
  metaPageId: string | null;
  instagramId: string | null;
  whatsappPhoneNumberId: string | null;
  systemPrompt: string;
  catalogData: unknown; // JSONB; serialised deterministically by promptBuilder
  llmProvider: string;
  llmModel: string;
  openaiKeySecretId: string | null;
  metaTokenSecretId: string | null;
  whatsappTokenSecretId: string | null;
  widgetPublicKey: string | null;
  widgetAllowedOrigins: string[];
  isActive: boolean;
  ordersEnabled: boolean;
  ownerNotifyWhatsapp: string | null;
  ownerNotifyTemplate: string | null;
  customOrdersEnabled: boolean;
  customOrdersRequireApproval: boolean;
  customOrderInstructions: string | null;
  mediaHandling: MediaHandling;
  businessType: BusinessType;
  bookingLink: string | null;
  knowledgeBase: unknown; // JSONB; shape in docs/12 §3.1, serialised deterministically by promptBuilder
  businessHours: unknown; // JSONB; { tz, week:[{ day, open, close }...], note? }, see docs/12 §4
  timezone: string | null; // IANA tz, canonical for the open-now verdict (docs/12 §4.1)
  paymentsEnabled: boolean;
  paymentMethods: PaymentMethod[];
  paymentInstructions: string | null;
  paymentProvider: string | null;
  paymentKeySecretId: string | null;
  defaultCurrency: string;
  prepaidRequired: boolean;
}

export interface ChatSession {
  id: string;
  tenantId: string;
  platform: Platform;
  externalUserId: string;
  isHumanHandoff: boolean;
  alertSignal: AlertSignal | null;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  tenantId: string;
  role: MessageRole;
  content: string;
  attachments: OrderAttachment[] | null;
  createdAt: string;
}

export interface OrderItem {
  name: string;
  qty: number;
  price?: number;
  sku?: string;
  customization?: string;
}

/** A persisted, tenant-scoped media reference on an order — never a token/CDN url. See docs/10 §2.4. */
export interface OrderAttachment {
  kind: 'image' | 'audio' | 'video';
  storagePath: string;
  mimeType: string;
}

/** A confirmed (or, per docs/10 §3.3, pending-approval) customer order captured by the create_order tool. */
export interface Order {
  id: string;
  tenantId: string;
  sessionId: string | null;
  status: OrderStatus;
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  items: OrderItem[];
  notes: string | null;
  platform: Platform | null;
  externalUserId: string | null;
  ownerNotifiedAt: string | null;
  attachments: OrderAttachment[] | null;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod | null;
  paymentProvider: string | null;
  paymentReference: string | null;
  amountTotal: number | null;
  currency: string | null;
  paidAt: string | null;
  paymentProof: OrderAttachment | null;
  createdAt: string;
}

export type NotificationScope = 'agency' | 'tenant';
export type NotificationType = 'new_order' | 'handoff' | 'alert_signal' | 'channel_request' | 'payment_proof';
export type NotificationEntityType = 'order' | 'session' | 'tenant';

/** A live notification-feed row (docs/14). Writes are service-role only; reads are RLS-scoped per audience. */
export interface Notification {
  id: string;
  scope: NotificationScope;
  tenantId: string | null;
  type: NotificationType;
  title: string;
  body: string | null;
  entityType: NotificationEntityType | null;
  entityId: string | null;
  link: string;
  isRead: boolean;
  createdAt: string;
}

/** `profiles.notification_prefs` shape (app-validated JSONB, all keys optional). See docs/14 §2.3. */
export interface NotificationPrefs {
  emailEnabled?: boolean;
  mutedTypes?: NotificationType[];
}

export type AttachmentKind = 'image' | 'audio' | 'video';

/**
 * A media descriptor extracted from a raw webhook payload, BEFORE download.
 * WhatsApp carries an authenticated `mediaId` (needs a token-bearing fetch);
 * Messenger/IG carry a time-limited CDN `url` (fetched directly). See docs/10 §2.1/§2.5.
 */
export interface InboundAttachment {
  kind: AttachmentKind;
  mediaId?: string;
  url?: string;
  mimeType?: string;
  caption?: string;
}

/**
 * Normalised inbound event — the single shape every channel (Meta webhook,
 * website widget, future pgmq consumer) hands to the orchestrator.
 */
export interface InboundMessage {
  platform: Platform;
  /** Destination the message arrived on (page id / phone-number id / widget key). */
  destinationId: string;
  /** The customer's id on that platform. */
  externalUserId: string;
  text: string;
  attachments?: InboundAttachment[];
  providerMsgId?: string;
}
