'use client';

import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { Database } from '@/types/database';
import { updateIntakeAction } from './actions';
import { initialUpdateIntakeState } from './intake-state';

type IntakeTenant = Pick<
  Database['public']['Tables']['tenants']['Row'],
  | 'id'
  | 'system_prompt'
  | 'catalog_data'
  | 'catalog_freeform_text'
  | 'custom_orders_enabled'
  | 'custom_orders_require_approval'
  | 'custom_order_instructions'
  | 'media_handling'
  | 'business_type'
  | 'booking_link'
  | 'knowledge_base'
  | 'business_hours'
  | 'timezone'
  | 'payments_enabled'
  | 'payment_methods'
  | 'payment_instructions'
  | 'default_currency'
  | 'prepaid_required'
>;

interface FaqEntry {
  q: string;
  a: string;
}

interface KnowledgeBaseState {
  faq: FaqEntry[];
  delivery: string;
  returns: string;
  location: string;
  note: string;
}

interface HourRow {
  day: string;
  open: string;
  close: string;
}

interface BusinessHoursState {
  week: HourRow[];
  note: string;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function parseKnowledgeBase(raw: unknown): KnowledgeBaseState {
  const obj = isRecord(raw) ? raw : {};
  const faqRaw = Array.isArray(obj.faq) ? obj.faq.filter(isRecord) : [];
  return {
    faq: faqRaw.map((e) => ({ q: typeof e.q === 'string' ? e.q : '', a: typeof e.a === 'string' ? e.a : '' })),
    delivery: typeof obj.delivery === 'string' ? obj.delivery : '',
    returns: typeof obj.returns === 'string' ? obj.returns : '',
    location: typeof obj.location === 'string' ? obj.location : '',
    note: typeof obj.note === 'string' ? obj.note : '',
  };
}

function parseBusinessHours(raw: unknown): BusinessHoursState {
  const obj = isRecord(raw) ? raw : {};
  const weekRaw = Array.isArray(obj.week) ? obj.week.filter(isRecord) : [];
  const byDay = new Map(weekRaw.map((e) => [String(e.day ?? ''), e]));
  return {
    week: DAYS.map((day) => {
      const e = byDay.get(day);
      return {
        day,
        open: e && typeof e.open === 'string' ? e.open : '',
        close: e && typeof e.close === 'string' ? e.close : '',
      };
    }),
    note: typeof obj.note === 'string' ? obj.note : '',
  };
}

const MEDIA_HANDLING_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  {
    value: 'match_catalogue',
    label: 'Match to my catalogue',
    hint: 'Try to identify the closest catalogue item and capture the delta. (Default)',
  },
  {
    value: 'accept_any',
    label: 'Accept any',
    hint: "Take the request even if it isn't in the catalogue.",
  },
  {
    value: 'reject',
    label: 'Reject',
    hint: 'Politely decline media, ask for a text description instead.',
  },
];

const BUSINESS_TYPE_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  {
    value: 'product',
    label: 'Product-based',
    hint: 'Sells physical items customers order from a catalogue. (Default)',
  },
  {
    value: 'service',
    label: 'Service-based',
    hint: 'Offers services — appointments/bookings, or custom quotes your team prices.',
  },
];

const PAYMENT_METHOD_OPTIONS: Array<{ value: string; label: string; hint: string; disabled?: boolean }> = [
  { value: 'cod', label: 'Cash on Delivery', hint: 'No prepayment needed; confirmed on delivery.' },
  {
    value: 'manual_transfer',
    label: 'Bank/Wallet Transfer',
    hint: 'Share your account details; the customer sends a receipt screenshot after paying.',
  },
  {
    value: 'gateway',
    label: 'Card/Online Payment',
    hint: 'Coming soon — needs a payment provider connected first.',
    disabled: true,
  },
];

export function IntakeForm({ tenant, viewer }: { tenant: IntakeTenant; viewer: 'admin' | 'client' }) {
  const isAdmin = viewer === 'admin';
  const boundAction = updateIntakeAction.bind(null, tenant.id);
  const [state, formAction, isPending] = useActionState(boundAction, initialUpdateIntakeState);
  const [catalogFreeform, setCatalogFreeform] = useState(tenant.catalog_freeform_text ?? '');
  const [mediaHandling, setMediaHandling] = useState(tenant.media_handling ?? 'match_catalogue');
  const [businessType, setBusinessType] = useState(tenant.business_type ?? 'product');
  const [knowledge, setKnowledge] = useState<KnowledgeBaseState>(() => parseKnowledgeBase(tenant.knowledge_base));
  const [hours, setHours] = useState<BusinessHoursState>(() => parseBusinessHours(tenant.business_hours));
  const [timezone, setTimezone] = useState(tenant.timezone ?? '');
  const [paymentsEnabled, setPaymentsEnabled] = useState(tenant.payments_enabled);
  const [paymentMethods, setPaymentMethods] = useState<string[]>(
    tenant.payment_methods.length ? tenant.payment_methods : ['cod'],
  );
  const [paymentInstructions, setPaymentInstructions] = useState(tenant.payment_instructions ?? '');
  const [defaultCurrency, setDefaultCurrency] = useState(tenant.default_currency);

  useEffect(() => {
    if (state.success) toast.success('Intake config saved.');
  }, [state]);

  function updateFaq(index: number, patch: Partial<FaqEntry>) {
    setKnowledge((k) => ({ ...k, faq: k.faq.map((e, i) => (i === index ? { ...e, ...patch } : e)) }));
  }

  function addFaq() {
    setKnowledge((k) => ({ ...k, faq: [...k.faq, { q: '', a: '' }] }));
  }

  function removeFaq(index: number) {
    setKnowledge((k) => ({ ...k, faq: k.faq.filter((_, i) => i !== index) }));
  }

  function updateHourRow(day: string, patch: Partial<HourRow>) {
    setHours((h) => ({ ...h, week: h.week.map((r) => (r.day === day ? { ...r, ...patch } : r)) }));
  }

  function togglePaymentMethod(value: string) {
    setPaymentMethods((methods) => (methods.includes(value) ? methods.filter((m) => m !== value) : [...methods, value]));
  }

  return (
    <form action={formAction} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{isAdmin ? '1. Business type' : 'What kind of business is this?'}</CardTitle>
          <CardDescription>Product or service — this decides how the AI handles orders vs bookings/quotes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <input type="hidden" name="business_type" value={businessType} />
          <div className="flex flex-col gap-2">
            {BUSINESS_TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setBusinessType(opt.value)}
                className={`flex flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors ${
                  businessType === opt.value ? 'border-primary bg-primary/5' : 'border-input'
                }`}
              >
                <span className="text-sm font-medium">{opt.label}</span>
                <span className="text-xs text-muted-foreground">{opt.hint}</span>
              </button>
            ))}
          </div>
          {businessType === 'service' && (
            <div className="flex flex-col gap-1.5 pt-1">
              <Label htmlFor="booking_link">Booking link (optional)</Label>
              <Input
                id="booking_link"
                name="booking_link"
                type="url"
                defaultValue={tenant.booking_link ?? ''}
                placeholder="https://calendly.com/…"
              />
              <p className="text-xs text-muted-foreground">
                Set this if customers should book appointments directly — the AI shares the link instead of
                collecting details. Leave blank and the AI will collect a quote request for your team to price
                (appears in the approval queue on Orders; reply with the priced quote via chat take-over).
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{isAdmin ? '2. Business nature' : 'Tell us about your business'}</CardTitle>
          <CardDescription>
            What the business sells, its tone, and languages. Seeds the AI&apos;s system prompt.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            id="system_prompt"
            name="system_prompt"
            rows={4}
            defaultValue={tenant.system_prompt}
            placeholder="You are the AI assistant for…"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{isAdmin ? '3. Standard catalogue' : 'What do you sell?'}</CardTitle>
          <CardDescription>
            {isAdmin
              ? 'Reference data the AI answers from (JSON). The client’s own words, if they’ve entered any, are shown below for reference — this box is what the AI actually reads.'
              : 'List your items, services, or packages in your own words — prices, options, whatever you’d tell a customer. We turn this into something your AI assistant can answer questions from.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isAdmin ? (
            <>
              <Textarea
                id="catalog_data"
                name="catalog_data"
                rows={6}
                defaultValue={JSON.stringify(tenant.catalog_data ?? {}, null, 2)}
              />
              {tenant.catalog_freeform_text && (
                <div className="rounded-lg border border-input bg-muted/40 p-3">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Client&apos;s own words (read-only)</p>
                  <p className="whitespace-pre-wrap text-sm">{tenant.catalog_freeform_text}</p>
                </div>
              )}
            </>
          ) : (
            <Textarea
              id="catalog_freeform"
              name="catalog_freeform"
              rows={8}
              value={catalogFreeform}
              onChange={(e) => setCatalogFreeform(e.target.value)}
              placeholder={
                'e.g. Chocolate cake - Rs 2500, serves 8\nRed velvet cake - Rs 3000, serves 8\nCupcakes - Rs 150 each, minimum order of 6\nFree delivery on orders over Rs 5000'
              }
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{isAdmin ? '4. Custom orders' : 'Custom orders'}</CardTitle>
          <CardDescription>Let customers ask for a customised version of one of your items.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="custom_orders_enabled">Enable custom orders</Label>
            <Switch
              id="custom_orders_enabled"
              name="custom_orders_enabled"
              defaultChecked={tenant.custom_orders_enabled}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="custom_order_instructions">In your own words</Label>
            <Textarea
              id="custom_order_instructions"
              name="custom_order_instructions"
              rows={4}
              defaultValue={tenant.custom_order_instructions ?? ''}
              placeholder="We make custom phone cases; customers can put a name/photo on any model; we can't do glass cases; turnaround 3 days…"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{isAdmin ? '5. Customer example media' : 'Photos & voice notes from customers'}</CardTitle>
          <CardDescription>
            How should the AI handle a picture, voice note, or video a customer sends as an example?
          </CardDescription>
        </CardHeader>
        <CardContent>
          <input type="hidden" name="media_handling" value={mediaHandling} />
          <div className="flex flex-col gap-2">
            {MEDIA_HANDLING_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMediaHandling(opt.value)}
                className={`flex flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors ${
                  mediaHandling === opt.value ? 'border-primary bg-primary/5' : 'border-input'
                }`}
              >
                <span className="text-sm font-medium">{opt.label}</span>
                <span className="text-xs text-muted-foreground">{opt.hint}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{isAdmin ? '6. Approval' : 'Order approval'}</CardTitle>
          <CardDescription>Should custom orders need your sign-off before they&apos;re final?</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Approve each custom order before it&apos;s final</p>
              <p className="text-xs text-muted-foreground">Off = auto-send finalised orders straight to you.</p>
            </div>
            <Switch
              id="custom_orders_require_approval"
              name="custom_orders_require_approval"
              defaultChecked={tenant.custom_orders_require_approval}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{isAdmin ? '7. Knowledge & FAQ' : 'Common questions'}</CardTitle>
          <CardDescription>
            Answers the AI can give straight away — delivery, returns, location, and common questions, in your
            own words.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="knowledge_delivery">Delivery</Label>
            <Textarea
              id="knowledge_delivery"
              rows={2}
              value={knowledge.delivery}
              onChange={(e) => setKnowledge((k) => ({ ...k, delivery: e.target.value }))}
              placeholder="Delivery charge PKR 200; free over PKR 5000. COD available nationwide."
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="knowledge_returns">Returns</Label>
            <Textarea
              id="knowledge_returns"
              rows={2}
              value={knowledge.returns}
              onChange={(e) => setKnowledge((k) => ({ ...k, returns: e.target.value }))}
              placeholder="7-day exchange with receipt; custom orders are non-returnable."
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="knowledge_location">Location</Label>
            <Input
              id="knowledge_location"
              value={knowledge.location}
              onChange={(e) => setKnowledge((k) => ({ ...k, location: e.target.value }))}
              placeholder="Shop 12, Tariq Road, Karachi."
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>FAQ</Label>
            {knowledge.faq.map((entry, i) => (
              <div key={i} className="flex flex-col gap-1.5 rounded-lg border border-input p-3">
                <Input value={entry.q} onChange={(e) => updateFaq(i, { q: e.target.value })} placeholder="Question" />
                <Textarea
                  rows={2}
                  value={entry.a}
                  onChange={(e) => updateFaq(i, { a: e.target.value })}
                  placeholder="Answer"
                />
                <Button type="button" variant="ghost" size="sm" className="self-end" onClick={() => removeFaq(i)}>
                  Remove
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addFaq}>
              + Add question
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="knowledge_note">Anything else</Label>
            <Textarea
              id="knowledge_note"
              rows={2}
              value={knowledge.note}
              onChange={(e) => setKnowledge((k) => ({ ...k, note: e.target.value }))}
              placeholder="Free-form anything-else the AI should know."
            />
          </div>
          <input type="hidden" name="knowledge_base_json" value={JSON.stringify(knowledge)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{isAdmin ? '8. Business hours' : 'Business hours'}</CardTitle>
          <CardDescription>
            So the AI can answer &quot;are you open right now?&quot; accurately. Leave a day&apos;s times blank
            for closed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="timezone">{isAdmin ? 'Timezone (IANA, e.g. Asia/Karachi)' : 'Timezone (e.g. Asia/Karachi)'}</Label>
            <Input
              id="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="Asia/Karachi"
            />
          </div>
          <div className="flex flex-col gap-2">
            {hours.week.map((row) => (
              <div key={row.day} className="flex items-center gap-2">
                <span className="w-10 text-sm font-medium">{row.day}</span>
                <Input type="time" value={row.open} onChange={(e) => updateHourRow(row.day, { open: e.target.value })} />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  type="time"
                  value={row.close}
                  onChange={(e) => updateHourRow(row.day, { close: e.target.value })}
                />
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hours_note">Note (optional)</Label>
            <Input
              id="hours_note"
              value={hours.note}
              onChange={(e) => setHours((h) => ({ ...h, note: e.target.value }))}
              placeholder="Closed on public holidays"
            />
          </div>
          <input
            type="hidden"
            name="business_hours_json"
            value={JSON.stringify({ tz: timezone, week: hours.week, note: hours.note })}
          />
          <input type="hidden" name="timezone" value={timezone} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{isAdmin ? '9. Payments' : 'Payments'}</CardTitle>
          <CardDescription>How customers pay, and what the AI is allowed to tell them about it.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input type="hidden" name="payments_enabled" value={paymentsEnabled ? 'on' : ''} />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Enable payments</p>
              <p className="text-xs text-muted-foreground">
                Off = the AI never mentions payment methods or totals.
              </p>
            </div>
            <Switch checked={paymentsEnabled} onCheckedChange={setPaymentsEnabled} />
          </div>
          {paymentsEnabled && (
            <>
              <div className="flex flex-col gap-2">
                <Label>Accepted methods</Label>
                {PAYMENT_METHOD_OPTIONS.map((opt) => {
                  const selected = paymentMethods.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={opt.disabled}
                      onClick={() => togglePaymentMethod(opt.value)}
                      className={`flex flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors ${
                        opt.disabled
                          ? 'cursor-not-allowed border-input opacity-50'
                          : selected
                            ? 'border-primary bg-primary/5'
                            : 'border-input'
                      }`}
                    >
                      <span className="text-sm font-medium">{opt.label}</span>
                      <span className="text-xs text-muted-foreground">{opt.hint}</span>
                    </button>
                  );
                })}
                {paymentMethods.map((m) => (
                  <input key={m} type="hidden" name="payment_methods" value={m} />
                ))}
              </div>
              {paymentMethods.includes('manual_transfer') && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="payment_instructions">Bank/wallet details</Label>
                  <Textarea
                    id="payment_instructions"
                    name="payment_instructions"
                    rows={3}
                    value={paymentInstructions}
                    onChange={(e) => setPaymentInstructions(e.target.value)}
                    placeholder="JazzCash: 0300-1234567 (Business Name). Send the receipt screenshot after transfer."
                  />
                  <p className="text-xs text-muted-foreground">
                    Shared with the customer word-for-word — the AI never edits or shortens this.
                  </p>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="default_currency">Currency</Label>
                <Input
                  id="default_currency"
                  name="default_currency"
                  className="max-w-[10rem]"
                  value={defaultCurrency}
                  onChange={(e) => setDefaultCurrency(e.target.value)}
                  placeholder="PKR"
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Say orders are reserved until paid</p>
                  <p className="text-xs text-muted-foreground">
                    Wording only — the AI mentions this, but payment is never required to place an order.
                  </p>
                </div>
                <Switch id="prepaid_required" name="prepaid_required" defaultChecked={tenant.prepaid_required} />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" disabled={isPending}>
        {isPending ? 'Saving…' : isAdmin ? 'Save intake config' : 'Save business details'}
      </Button>
    </form>
  );
}
