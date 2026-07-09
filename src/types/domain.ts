/**
 * Hand-written domain types shared across services. These mirror the SQL enums
 * and the columns the app logic actually uses (a stable façade over the
 * generated database.ts). See docs/03-DATABASE.md.
 */

export type Platform = 'whatsapp' | 'facebook' | 'instagram' | 'web' | 'voice';
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';
export type MemberRole = 'platform_admin' | 'tenant_admin' | 'tenant_agent';

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
}

export interface ChatSession {
  id: string;
  tenantId: string;
  platform: Platform;
  externalUserId: string;
  isHumanHandoff: boolean;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  tenantId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
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
  providerMsgId?: string;
}
