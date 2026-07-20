'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import * as tenants from '@/services/tenants';
import * as orders from '@/services/orders';
import * as messages from '@/services/messages';
import { getProvider } from '@/services/ai/provider';
import { getLlmKey } from '@/lib/secrets';
import { estimateCostUsd } from '@/services/ai/pricing';
import { createServiceClient } from '@/lib/supabase/service';
import { sendTemplate } from '@/services/meta/send';
import { notifyBoth } from '@/services/notifications';
import { MEMORY_TOKEN_BUDGET } from '@/lib/constants';
import type { OrderItem, PaymentMethod } from '@/types/domain';

/**
 * "Generate order summary" (docs: order-event-messaging plan, Phase D) — a human-confirmed
 * alternative to the AI silently writing an order after a handoff conversation. This is a
 * one-shot extraction over the transcript, same established pattern as
 * services/ai/catalogueParser.ts (plain provider.chat(), temperature 0, JSON-only prompt,
 * strip-fence + parse + fallback) — no forced/structured output exists in this codebase's
 * LLM provider abstraction. paymentMethod is intentionally never guessed here; the human
 * picks it from tenant.paymentMethods in the dialog.
 */

export interface OrderSummaryDraft {
  items: OrderItem[];
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  notes: string;
}

const EMPTY_DRAFT: OrderSummaryDraft = { items: [], customerName: '', customerPhone: '', customerAddress: '', notes: '' };

const SYSTEM_PROMPT = `You extract a customer order from a chat transcript between a business (assistant/system lines) and a customer (user lines). Output ONLY a JSON object, no prose, no markdown fences.

Shape:
{
  "items": [{"name": string, "qty": number, "customization": string (optional)}],
  "customerName": string,
  "customerPhone": string,
  "customerAddress": string,
  "notes": string
}

Only include an item if the customer clearly agreed to order it. Leave a field as an empty string ("") or empty array if it was never mentioned in the transcript — never invent details. Do not include price or payment method.`;

function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

function safeParseDraft(text: string): OrderSummaryDraft {
  try {
    const parsed = JSON.parse(stripCodeFence(text)) as Partial<OrderSummaryDraft>;
    return {
      items: Array.isArray(parsed.items)
        ? parsed.items
            .filter((i): i is OrderItem => Boolean(i && typeof i.name === 'string' && i.name.trim()))
            .map((i) => ({ name: i.name, qty: typeof i.qty === 'number' && i.qty > 0 ? i.qty : 1, customization: i.customization }))
        : [],
      customerName: typeof parsed.customerName === 'string' ? parsed.customerName : '',
      customerPhone: typeof parsed.customerPhone === 'string' ? parsed.customerPhone : '',
      customerAddress: typeof parsed.customerAddress === 'string' ? parsed.customerAddress : '',
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

export async function generateOrderSummaryAction(sessionId: string): Promise<OrderSummaryDraft> {
  const supabase = await createSupabaseServerClient();

  // RLS-authenticated read also acts as the access check (same pattern as manualSendAction).
  const { data: session, error: sessionError } = await supabase
    .from('chat_sessions')
    .select('id, tenant_id')
    .eq('id', sessionId)
    .single();
  if (sessionError || !session) throw new Error(sessionError?.message ?? 'Session not found.');

  const tenant = await tenants.getById(session.tenant_id);
  if (!tenant) throw new Error('Tenant not found.');

  const history = await messages.loadWindow(sessionId, MEMORY_TOKEN_BUDGET);
  if (history.length === 0) return EMPTY_DRAFT;

  const transcript = history.map((m) => `${m.role}: ${m.content}`).join('\n');

  const { key, usedByok } = await getLlmKey(tenant);
  const provider = getProvider(tenant.llmProvider);
  const result = await provider.chat(
    {
      model: tenant.llmModel,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: transcript },
      ],
      temperature: 0,
      maxTokens: 1000,
    },
    key,
  );

  const client = createServiceClient();
  await client.from('usage_logs').insert({
    tenant_id: tenant.id,
    session_id: sessionId,
    provider: tenant.llmProvider,
    model: tenant.llmModel,
    prompt_tokens: result.usage.promptTokens,
    completion_tokens: result.usage.completionTokens,
    total_tokens: result.usage.totalTokens,
    estimated_cost_usd: estimateCostUsd(result.usage, tenant.llmModel),
    used_byok: usedByok,
  });

  return safeParseDraft(result.text);
}

export interface OrderSummaryFields {
  items: OrderItem[];
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  notes: string;
  /** Human-picked from tenant.paymentMethods in the dialog — never guessed. */
  paymentMethod: PaymentMethod | null;
}

export async function createOrderFromSummaryAction(sessionId: string, fields: OrderSummaryFields): Promise<{ orderId: string }> {
  if (fields.items.length === 0) throw new Error('Add at least one item before creating the order.');

  const supabase = await createSupabaseServerClient();
  const { data: session, error: sessionError } = await supabase
    .from('chat_sessions')
    .select('id, tenant_id, platform, external_user_id')
    .eq('id', sessionId)
    .single();
  if (sessionError || !session) throw new Error(sessionError?.message ?? 'Session not found.');

  const tenant = await tenants.getById(session.tenant_id);
  if (!tenant) throw new Error('Tenant not found.');

  const paymentMethod =
    tenant.paymentsEnabled && fields.paymentMethod && tenant.paymentMethods.includes(fields.paymentMethod)
      ? fields.paymentMethod
      : null;

  // Same server-decided rule create_order (services/tools/createOrder.ts) uses — never model/human-supplied.
  const status = tenant.customOrdersEnabled && tenant.customOrdersRequireApproval ? 'pending' : 'confirmed';

  const fingerprint = orders.computeFingerprint(fields.items, {
    name: fields.customerName,
    phone: fields.customerPhone,
    address: fields.customerAddress,
  });

  const { order, duplicate } = await orders.createDeduped(
    {
      tenantId: session.tenant_id,
      sessionId: session.id,
      platform: session.platform,
      externalUserId: session.external_user_id,
      items: fields.items,
      customerName: fields.customerName || null,
      customerPhone: fields.customerPhone || null,
      customerAddress: fields.customerAddress || null,
      notes: fields.notes || null,
      status,
      paymentMethod,
      amountTotal: null,
      currency: paymentMethod ? tenant.defaultCurrency : null,
    },
    fingerprint,
  );

  if (duplicate || !order) {
    throw new Error('An identical order already exists for this conversation.');
  }

  // Mirrors createOrderTool's owner-visibility block so a human-created order gets
  // identical notification/push behaviour to an AI-created one.
  await notifyBoth({
    tenantId: session.tenant_id,
    type: 'new_order',
    entityType: 'order',
    entityId: order.id,
    agency: {
      title: status === 'pending' ? 'Order awaiting approval' : 'New order',
      body: `${tenant.businessName} — ${fields.customerName || 'Customer'}`,
      link: status === 'pending' ? '/admin/orders?status=pending' : '/admin/orders',
    },
    tenant: {
      title: status === 'pending' ? 'New order — awaiting your approval' : 'New order received',
      body: fields.customerName || 'Customer',
      link: '/dashboard/orders',
    },
  });

  if (order.status === 'confirmed' && tenant.ownerNotifyWhatsapp && tenant.ownerNotifyTemplate) {
    try {
      const itemsSummary = fields.items.map((i) => `${i.name} x${i.qty}`).join(', ');
      await sendTemplate({
        tenant,
        to: tenant.ownerNotifyWhatsapp,
        templateName: tenant.ownerNotifyTemplate,
        bodyParams: [fields.customerName || 'Customer', itemsSummary, fields.customerAddress || ''],
      });
      await orders.markOwnerNotified(order.id);
    } catch (err) {
      console.error('[orders] owner notify failed (order summary)', {
        tenantId: session.tenant_id,
        orderId: order.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  revalidatePath('/admin/orders');
  revalidatePath('/dashboard/orders');
  return { orderId: order.id };
}
