import { type NextRequest } from 'next/server';
import * as promptBuilder from '@/services/ai/promptBuilder';
import { getProvider } from '@/services/ai/provider';
import type { LlmMessage, LlmToolDef } from '@/services/ai/provider';
import { sanitizeInbound } from '@/services/security/sanitize';
import { env } from '@/lib/env';
import { DEMO_LLM_PROVIDER, DEMO_LLM_MODEL, MAX_TOOL_ROUNDS } from '@/lib/constants';
import { demoChatRequestSchema } from '@/services/demo/schema';

/**
 * Stateless public-demo chat endpoint (docs: "try it for your business" plan,
 * Phase B). No DB, no session, no tenant row — the entire "tenant" is the
 * visitor's own wizard answers, re-validated here (never trusted as-is). Runs
 * the SAME promptBuilder as the real orchestrator, always on a master key (see
 * DEMO_LLM_PROVIDER/DEMO_LLM_MODEL in lib/constants.ts) — a demo visitor can
 * never select a model or spend a real tenant's key. `create_order` is
 * intercepted to synthesise a simulated order card; nothing is written anywhere.
 */
export const runtime = 'nodejs';
export const maxDuration = 30;

// Mirrors services/tools/createOrder.ts's `def` (JSON schema only) — kept
// independent so this route stays free of the DB-bound tools/orders modules.
const DEMO_ORDER_TOOL: LlmToolDef = {
  name: 'create_order',
  description:
    'Create a confirmed customer order. Only call this after the customer has explicitly ' +
    'confirmed the complete order (items, name, address, phone) read back to them.',
  parameters: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            qty: { type: 'integer', minimum: 1 },
            customization: { type: 'string' },
            price: { type: 'number' },
          },
          required: ['name', 'qty'],
        },
      },
      customer_name: { type: 'string' },
      customer_phone: { type: 'string' },
      customer_address: { type: 'string' },
      notes: { type: 'string' },
    },
    required: ['items', 'customer_name', 'customer_phone', 'customer_address'],
  },
};

export interface DemoOrderCard {
  items: { name: string; qty: number; customization?: string }[];
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  status: 'pending' | 'confirmed';
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request.' }, 400);
  }

  const parsed = demoChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'Invalid demo request.' }, 400);
  }
  const { demoTenant, history, text } = parsed.data;

  const userText = sanitizeInbound(text);
  if (!userText) return json({ error: 'Empty message.' }, 400);

  // Freeform catalogue text is stuffed directly as the "catalogue" — the demo
  // skips the real parseCatalogueFreeform LLM pass to stay a single, cheap,
  // stateless call per turn (docs: "try it for your business" plan, Phase B).
  const tenantForPrompt = {
    id: 'demo',
    systemPrompt: demoTenant.systemPrompt.trim() || `You are the friendly AI assistant for ${demoTenant.businessName}.`,
    catalogData: { description: demoTenant.catalogFreeformText },
    ordersEnabled: true,
    customOrdersEnabled: demoTenant.customOrdersEnabled,
    customOrderInstructions: demoTenant.customOrderInstructions,
    mediaHandling: demoTenant.mediaHandling,
    customOrdersRequireApproval: demoTenant.customOrdersRequireApproval,
    businessType: demoTenant.businessType,
    bookingLink: demoTenant.bookingLink,
    knowledgeBase: demoTenant.knowledgeBase,
    businessHours: demoTenant.businessHours,
    paymentsEnabled: demoTenant.paymentsEnabled,
    paymentMethods: demoTenant.paymentMethods,
    paymentInstructions: demoTenant.paymentInstructions,
  };

  const built = promptBuilder.build({
    tenant: tenantForPrompt,
    history,
    userText,
  });

  if (!env.MASTER_OPENROUTER_KEY) {
    console.error('[demo/chat] MASTER_OPENROUTER_KEY is not configured');
    return json({ error: 'The demo assistant is unavailable right now — please try again shortly.' }, 502);
  }

  const provider = getProvider(DEMO_LLM_PROVIDER);
  const conversation: LlmMessage[] = [...built.messages];
  let finalText = '';
  let orderCard: DemoOrderCard | null = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let result;
    try {
      result = await provider.chat(
        {
          model: DEMO_LLM_MODEL,
          messages: conversation,
          cachePrefixLength: built.cachePrefixLength,
          tools: [DEMO_ORDER_TOOL],
        },
        env.MASTER_OPENROUTER_KEY,
      );
    } catch (err) {
      console.error('[demo/chat] provider call failed', { error: err instanceof Error ? err.message : String(err) });
      return json({ error: 'The demo assistant is unavailable right now — please try again shortly.' }, 502);
    }

    if (result.toolCalls?.length) {
      conversation.push({ role: 'assistant', content: result.text ?? '', toolCalls: result.toolCalls });
      for (const call of result.toolCalls) {
        if (call.name === 'create_order') {
          orderCard = buildSimulatedOrderCard(call.arguments, demoTenant.customOrdersRequireApproval);
          conversation.push({
            role: 'tool',
            toolCallId: call.id,
            content: JSON.stringify({ orderId: 'demo', status: orderCard.status }),
          });
        } else {
          conversation.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify({ error: 'Not available in the demo.' }) });
        }
      }
      continue; // let the model see the tool result and produce its next turn
    }

    finalText = result.text;
    break;
  }

  if (!finalText) {
    finalText = "Sorry, I'm having trouble replying right now — try rephrasing that?";
  }

  return json({ reply: finalText, orderCard }, 200);
}

function buildSimulatedOrderCard(rawArguments: string, requireApproval: boolean): DemoOrderCard {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(rawArguments);
  } catch {
    // Malformed model output — fall back to an empty order rather than 500ing the turn.
  }
  const items = Array.isArray(args.items)
    ? args.items
        .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
        .map((i) => ({
          name: typeof i.name === 'string' ? i.name : 'Item',
          qty: typeof i.qty === 'number' && i.qty > 0 ? i.qty : 1,
          ...(typeof i.customization === 'string' && i.customization ? { customization: i.customization } : {}),
        }))
    : [];
  return {
    items,
    customerName: typeof args.customer_name === 'string' ? args.customer_name : '',
    customerPhone: typeof args.customer_phone === 'string' ? args.customer_phone : '',
    customerAddress: typeof args.customer_address === 'string' ? args.customer_address : '',
    status: requireApproval ? 'pending' : 'confirmed',
  };
}

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
