import { z } from 'zod';

/**
 * Ephemeral demo tenant shape (docs: "try it for your business" plan, Phase B).
 * Mirrors the fields `updateIntakeAction` parses, in camelCase, with the SAME
 * allow-lists — this is the single source of truth shared by the client-side
 * wizard-output parser and the server-side re-validation in /api/demo/chat.
 */
export const demoTenantSchema = z.object({
  businessName: z.string().trim().min(1).max(120),
  systemPrompt: z.string().max(4000),
  catalogFreeformText: z.string().max(8000),
  businessType: z.enum(['product', 'service']),
  bookingLink: z.string().trim().max(300).nullable(),
  customOrdersEnabled: z.boolean(),
  customOrdersRequireApproval: z.boolean(),
  customOrderInstructions: z.string().max(2000).nullable(),
  mediaHandling: z.enum(['match_catalogue', 'accept_any', 'reject']),
  knowledgeBase: z.object({
    faq: z.array(z.object({ q: z.string().max(300), a: z.string().max(1000) })).max(20),
    delivery: z.string().max(1000),
    returns: z.string().max(1000),
    location: z.string().max(300),
    note: z.string().max(1000),
  }),
  businessHours: z.object({
    week: z.array(z.object({ day: z.string().max(10), open: z.string().max(10), close: z.string().max(10) })).max(7),
    note: z.string().max(300),
  }),
  timezone: z.string().max(60).nullable(),
  paymentsEnabled: z.boolean(),
  paymentMethods: z.array(z.enum(['cod', 'manual_transfer', 'gateway'])).max(3),
  paymentInstructions: z.string().max(1000).nullable(),
});

export type DemoTenantInput = z.infer<typeof demoTenantSchema>;

export const demoChatRequestSchema = z.object({
  demoTenant: demoTenantSchema,
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(4000),
      }),
    )
    .max(40),
  text: z.string().min(1).max(4000),
});

export type DemoChatRequest = z.infer<typeof demoChatRequestSchema>;

export const demoLeadRequestSchema = z.object({
  email: z.string().trim().email().max(200),
  demoTenant: demoTenantSchema,
});

export type DemoLeadRequest = z.infer<typeof demoLeadRequestSchema>;
