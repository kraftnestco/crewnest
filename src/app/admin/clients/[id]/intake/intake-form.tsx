'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { PromptArchitect } from '@/components/intake/prompt-architect';
import { COMMON_TIMEZONES, CURRENCY_OPTIONS } from '@/lib/constants';
import {
  BUSINESS_TYPE_OPTIONS,
  MEDIA_HANDLING_OPTIONS,
  PAYMENT_METHOD_OPTIONS,
  parseBusinessHours,
  parseKnowledgeBase,
  type BusinessHoursState,
  type FaqEntry,
  type IntakeTenant,
  type KnowledgeBaseState,
} from '@/components/intake/intake-shared';
import { generateSystemPromptAction, updateIntakeAction } from './actions';
import { initialUpdateIntakeState } from './intake-state';

/** Agency-only editor: raw JSON catalogue, no wizard steps. The client's own
 * step-by-step flow is `components/intake/intake-wizard.tsx`. */
export function IntakeForm({ tenant }: { tenant: IntakeTenant }) {
  const boundAction = updateIntakeAction.bind(null, tenant.id);
  const [state, formAction, isPending] = useActionState(boundAction, initialUpdateIntakeState);
  const [mediaHandling, setMediaHandling] = useState(tenant.media_handling ?? 'match_catalogue');
  const [businessType, setBusinessType] = useState(tenant.business_type ?? 'product');
  // Appointment booking (docs/24) — service-only, mirroring the client wizard.
  const [bookingEnabled, setBookingEnabled] = useState(tenant.booking_enabled ?? false);
  const [bookingMode, setBookingMode] = useState(tenant.booking_mode ?? 'calcom');
  const [systemPrompt, setSystemPrompt] = useState(tenant.system_prompt ?? '');
  const [knowledge, setKnowledge] = useState<KnowledgeBaseState>(() => parseKnowledgeBase(tenant.knowledge_base));
  const [hours, setHours] = useState<BusinessHoursState>(() => parseBusinessHours(tenant.business_hours));
  const [timezone, setTimezone] = useState(tenant.timezone ?? '');
  /** Every IANA zone the runtime knows, with a stored-but-unlisted value preserved. */
  const allTimezones = useMemo(() => {
    let zones: string[];
    try {
      zones = Intl.supportedValuesOf('timeZone') as string[];
    } catch {
      zones = [...COMMON_TIMEZONES];
    }
    const stored = tenant.timezone;
    return stored && !zones.includes(stored) ? [stored, ...zones] : zones;
  }, [tenant.timezone]);
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

  function updateHourRow(day: string, patch: Partial<{ open: string; close: string }>) {
    setHours((h) => ({ ...h, week: h.week.map((r) => (r.day === day ? { ...r, ...patch } : r)) }));
  }

  function togglePaymentMethod(value: string) {
    setPaymentMethods((methods) => (methods.includes(value) ? methods.filter((m) => m !== value) : [...methods, value]));
  }

  return (
    <form action={formAction} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>1. Business type</CardTitle>
          <CardDescription>Product or service. This decides how the AI handles orders vs bookings/quotes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <input type="hidden" name="business_type" value={businessType} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
          {/* Booking flags submit via hidden inputs, matching payments_enabled
              below — the visible controls are React-controlled and a checkbox
              inside a conditional block does not reliably reach FormData. */}
          <input
            type="hidden"
            name="booking_enabled"
            value={businessType === 'service' && bookingEnabled ? 'on' : ''}
          />
          <input type="hidden" name="booking_mode" value={bookingMode} />

          {/* Appointment booking (docs/24) — service businesses only. */}
          {businessType === 'service' && (
            <div className="flex flex-col gap-3 rounded-lg border p-3">
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={bookingEnabled}
                  onChange={(e) => setBookingEnabled(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="text-sm font-medium">Let the AI book appointments in chat</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    The AI offers real times from this business&apos;s hours and books them.
                  </span>
                </span>
              </label>

              {bookingEnabled && (
                <div className="flex flex-col gap-3 border-t pt-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="booking_mode">Where do meetings happen?</Label>
                    <select
                      id="booking_mode"
                      value={bookingMode}
                      onChange={(e) => setBookingMode(e.target.value)}
                      className="h-9 max-w-sm rounded-md border border-input bg-transparent px-3 text-sm"
                    >
                      <option value="calcom">Create a link per booking (Google Meet)</option>
                      <option value="own_link">They have their own link or address</option>
                    </select>
                  </div>

                  {bookingMode === 'own_link' && (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="booking_own_link">Their meeting link or address</Label>
                      <Input
                        id="booking_own_link"
                        name="booking_own_link"
                        defaultValue={tenant.booking_own_link ?? ''}
                        placeholder="https://zoom.us/j/… or 12 Main St, Lahore"
                      />
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="booking_duration_minutes">Length (minutes)</Label>
                      <Input
                        id="booking_duration_minutes"
                        name="booking_duration_minutes"
                        type="number"
                        min={5}
                        step={5}
                        defaultValue={tenant.booking_duration_minutes ?? 30}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="booking_lead_time_minutes">Minimum notice (minutes)</Label>
                      <Input
                        id="booking_lead_time_minutes"
                        name="booking_lead_time_minutes"
                        type="number"
                        min={0}
                        step={15}
                        defaultValue={tenant.booking_lead_time_minutes ?? 120}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="booking_max_days_ahead">Book up to (days)</Label>
                      <Input
                        id="booking_max_days_ahead"
                        name="booking_max_days_ahead"
                        type="number"
                        min={1}
                        defaultValue={tenant.booking_max_days_ahead ?? 30}
                      />
                    </div>
                  </div>

                  {/* Booking silently offers nothing without BOTH of these. */}
                  {(() => {
                    const missing = [
                      !timezone && 'a timezone',
                      !hours.week.some((r) => r.open && r.close) && 'opening hours',
                    ].filter(Boolean);
                    return missing.length > 0 ? (
                      <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                        Set {missing.join(' and ')} in Business hours below, or the AI will tell every customer there is
                        no availability.
                      </p>
                    ) : null;
                  })()}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Assistant persona</CardTitle>
          <CardDescription>
            The assistant&apos;s identity, voice, and scope. Generate it from a couple of answers, or edit it directly.
            Catalogue, hours, and payment details are added automatically, so there&apos;s no need to repeat them here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <input type="hidden" name="system_prompt" value={systemPrompt} />
          <PromptArchitect
            systemPrompt={systemPrompt}
            onSystemPromptChange={setSystemPrompt}
            businessType={businessType}
            catalogueHint={tenant.catalog_freeform_text ?? undefined}
            onGenerate={generateSystemPromptAction.bind(null, tenant.id)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Standard catalogue</CardTitle>
          <CardDescription>
            Reference data the AI answers from (JSON). The client’s own words, if they’ve entered any, are shown
            below for reference. This box is what the AI actually reads.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>4. Custom orders</CardTitle>
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

      <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>5. Customer example media</CardTitle>
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
          <CardTitle>6. Approval</CardTitle>
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
      </div>

      <Card>
        <CardHeader>
          <CardTitle>7. Knowledge & FAQ</CardTitle>
          <CardDescription>
            Answers the AI can give straight away: delivery, returns, location, and common questions, in your
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

      <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>8. Business hours</CardTitle>
          <CardDescription>
            So the AI can answer &quot;are you open right now?&quot; accurately. Leave a day&apos;s times blank
            for closed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="timezone">Timezone</Label>
            <select
              id="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="h-9 max-w-sm rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">Select a timezone…</option>
              <optgroup label="Common">
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, ' ')}
                  </option>
                ))}
              </optgroup>
              <optgroup label="All timezones">
                {allTimezones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, ' ')}
                  </option>
                ))}
              </optgroup>
            </select>
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
          <CardTitle>9. Payments</CardTitle>
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
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                </div>
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
                    Shared with the customer word-for-word. The AI never edits or shortens this.
                  </p>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="default_currency">Currency</Label>
                <select
                  id="default_currency"
                  name="default_currency"
                  className="h-9 max-w-[16rem] rounded-md border border-input bg-transparent px-3 text-sm"
                  value={defaultCurrency}
                  onChange={(e) => setDefaultCurrency(e.target.value)}
                >
                  {!CURRENCY_OPTIONS.some((c) => c.code === defaultCurrency) && defaultCurrency && (
                    <option value={defaultCurrency}>{defaultCurrency}</option>
                  )}
                  {CURRENCY_OPTIONS.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Say orders are reserved until paid</p>
                  <p className="text-xs text-muted-foreground">
                    Wording only. The AI mentions this, but payment is never required to place an order.
                  </p>
                </div>
                <Switch id="prepaid_required" name="prepaid_required" defaultChecked={tenant.prepaid_required} />
              </div>
            </>
          )}
        </CardContent>
      </Card>
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" disabled={isPending}>
        {isPending ? 'Saving…' : 'Save intake config'}
      </Button>
    </form>
  );
}
