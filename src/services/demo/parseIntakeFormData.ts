import { demoTenantSchema, type DemoTenantInput } from './schema';

/**
 * Converts the shared `IntakeWizard`'s finish-time FormData into a `DemoTenantInput`
 * (docs: "try it for your business" plan, Phase B). Same field names and allow-lists
 * as `updateIntakeAction` — that action writes to the DB, this just builds the
 * in-memory object the ephemeral demo prompt is built from. `businessName` is
 * collected separately at the email-capture step, so it's threaded in here rather
 * than read off the wizard's FormData.
 */

const MEDIA_HANDLING_VALUES = ['match_catalogue', 'accept_any', 'reject'] as const;
const BUSINESS_TYPE_VALUES = ['product', 'service'] as const;
const PAYMENT_METHOD_VALUES = ['cod', 'manual_transfer', 'gateway'] as const;

export function parseDemoIntakeFormData(fd: FormData, businessName: string): DemoTenantInput {
  const mediaHandlingRaw = String(fd.get('media_handling') ?? 'match_catalogue');
  const mediaHandling = (MEDIA_HANDLING_VALUES as readonly string[]).includes(mediaHandlingRaw)
    ? (mediaHandlingRaw as DemoTenantInput['mediaHandling'])
    : 'match_catalogue';

  const businessTypeRaw = String(fd.get('business_type') ?? 'product');
  const businessType = (BUSINESS_TYPE_VALUES as readonly string[]).includes(businessTypeRaw)
    ? (businessTypeRaw as DemoTenantInput['businessType'])
    : 'product';

  const paymentMethodsRaw = fd.getAll('payment_methods').map(String);
  const paymentMethods = paymentMethodsRaw.filter(
    (m): m is DemoTenantInput['paymentMethods'][number] => (PAYMENT_METHOD_VALUES as readonly string[]).includes(m),
  );

  let knowledgeBase: DemoTenantInput['knowledgeBase'] = { faq: [], delivery: '', returns: '', location: '', note: '' };
  const kbRaw = String(fd.get('knowledge_base_json') ?? '').trim();
  if (kbRaw) {
    try {
      const parsed = JSON.parse(kbRaw);
      knowledgeBase = {
        faq: Array.isArray(parsed.faq) ? parsed.faq : [],
        delivery: typeof parsed.delivery === 'string' ? parsed.delivery : '',
        returns: typeof parsed.returns === 'string' ? parsed.returns : '',
        location: typeof parsed.location === 'string' ? parsed.location : '',
        note: typeof parsed.note === 'string' ? parsed.note : '',
      };
    } catch {
      // Malformed — keep the blank default rather than fail the whole demo.
    }
  }

  let businessHours: DemoTenantInput['businessHours'] = { week: [], note: '' };
  const bhRaw = String(fd.get('business_hours_json') ?? '').trim();
  if (bhRaw) {
    try {
      const parsed = JSON.parse(bhRaw);
      businessHours = {
        week: Array.isArray(parsed.week) ? parsed.week : [],
        note: typeof parsed.note === 'string' ? parsed.note : '',
      };
    } catch {
      // Malformed — keep the blank default rather than fail the whole demo.
    }
  }

  return demoTenantSchema.parse({
    businessName,
    systemPrompt: String(fd.get('system_prompt') ?? '').slice(0, 4000),
    catalogFreeformText: String(fd.get('catalog_freeform') ?? '').slice(0, 8000),
    businessType,
    bookingLink: String(fd.get('booking_link') ?? '').trim() || null,
    customOrdersEnabled: fd.get('custom_orders_enabled') === 'on',
    customOrdersRequireApproval: fd.get('custom_orders_require_approval') === 'on',
    customOrderInstructions: String(fd.get('custom_order_instructions') ?? '').trim() || null,
    mediaHandling,
    knowledgeBase,
    businessHours,
    timezone: String(fd.get('timezone') ?? '').trim() || null,
    paymentsEnabled: fd.get('payments_enabled') === 'on',
    paymentMethods: paymentMethods.length ? paymentMethods : ['cod'],
    paymentInstructions: String(fd.get('payment_instructions') ?? '').trim() || null,
  });
}
