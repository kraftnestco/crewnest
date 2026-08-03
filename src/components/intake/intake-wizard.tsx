'use client';

import { useMemo, useState } from 'react';
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
  VOICE_HANDLING_OPTIONS,
  parseBusinessHours,
  parseKnowledgeBase,
  type FaqEntry,
  type GenerateSystemPromptResult,
  type IntakeTenant,
  type PromptArchitectFields,
} from '@/components/intake/intake-shared';

const STEP_TITLES = [
  'What kind of business is this?',
  "Your assistant's personality",
  'What do you sell?',
  'Custom orders',
  'Photos & voice notes from customers',
  'Order approval',
  'Common questions',
  'Business hours',
  'Payments',
];

const LAST_STEP = STEP_TITLES.length - 1;

/**
 * Mode-agnostic step wizard over the intake fields (docs: "try it for your
 * business" plan, Phase A). `onFinish` receives a FormData shaped exactly like
 * the field names `updateIntakeAction` already parses — the dashboard wraps
 * this with `useActionState` to save for real; a future demo mode can wrap it
 * with a client-only handler instead. This component never talks to the
 * server itself.
 */
export function IntakeWizard({
  tenant,
  onFinish,
  isSubmitting,
  submitError,
  finishLabel = 'Finish setup',
  onGeneratePrompt,
}: {
  tenant: IntakeTenant;
  onFinish: (formData: FormData) => void;
  isSubmitting?: boolean;
  submitError?: string | null;
  finishLabel?: string;
  /** Prompt Architect action (docs/19 O1). Omitted on the public demo (no tenant/LLM key). */
  onGeneratePrompt?: (fields: PromptArchitectFields) => Promise<GenerateSystemPromptResult>;
}) {
  const [step, setStep] = useState(0);

  const [businessType, setBusinessType] = useState(tenant.business_type ?? 'product');
  const [bookingLink, setBookingLink] = useState(tenant.booking_link ?? '');
  // Appointment booking (docs/24). Service-only — the tools are gated on
  // businessType === 'service' in the registry, so offering this to a product
  // business would enable a feature that silently does nothing.
  const [bookingEnabled, setBookingEnabled] = useState(tenant.booking_enabled ?? false);
  const [bookingMode, setBookingMode] = useState(tenant.booking_mode ?? 'calcom');
  const [bookingOwnLink, setBookingOwnLink] = useState(tenant.booking_own_link ?? '');
  const [bookingDuration, setBookingDuration] = useState(String(tenant.booking_duration_minutes ?? 30));
  const [bookingLeadTime, setBookingLeadTime] = useState(String(tenant.booking_lead_time_minutes ?? 120));
  const [bookingMaxDays, setBookingMaxDays] = useState(String(tenant.booking_max_days_ahead ?? 30));
  const [systemPrompt, setSystemPrompt] = useState(tenant.system_prompt ?? '');
  const [catalogFreeform, setCatalogFreeform] = useState(tenant.catalog_freeform_text ?? '');
  const [customOrdersEnabled, setCustomOrdersEnabled] = useState(tenant.custom_orders_enabled);
  const [customOrderInstructions, setCustomOrderInstructions] = useState(tenant.custom_order_instructions ?? '');
  const [mediaHandling, setMediaHandling] = useState(tenant.media_handling ?? 'match_catalogue');
  const [voiceHandling, setVoiceHandling] = useState(tenant.voice_handling ?? 'human_review');
  const [requireApproval, setRequireApproval] = useState(tenant.custom_orders_require_approval);
  const [knowledge, setKnowledge] = useState(() => parseKnowledgeBase(tenant.knowledge_base));
  const [hours, setHours] = useState(() => parseBusinessHours(tenant.business_hours));
  const [timezone, setTimezone] = useState(tenant.timezone ?? '');
  /**
   * Every IANA zone the runtime knows (~418), rather than a hardcoded list that
   * would drift as the tz database changes. Guarded because
   * `Intl.supportedValuesOf` is relatively new — a runtime without it falls
   * back to the common list rather than rendering an empty dropdown.
   *
   * A stored timezone outside the list is appended so an existing value is
   * never silently dropped from the options (which would look like the field
   * had reset itself).
   */
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

  function handleFinish() {
    const fd = new FormData();
    fd.set('business_type', businessType);
    fd.set('booking_link', bookingLink);
    // Only ever submit booking config for a service business, so flipping the
    // type to 'product' can't leave a stale enabled flag behind.
    fd.set('booking_enabled', businessType === 'service' && bookingEnabled ? 'on' : '');
    fd.set('booking_mode', bookingMode);
    fd.set('booking_own_link', bookingOwnLink);
    fd.set('booking_duration_minutes', bookingDuration);
    fd.set('booking_lead_time_minutes', bookingLeadTime);
    fd.set('booking_max_days_ahead', bookingMaxDays);
    fd.set('system_prompt', systemPrompt);
    fd.set('catalog_freeform', catalogFreeform);
    if (customOrdersEnabled) fd.set('custom_orders_enabled', 'on');
    fd.set('custom_order_instructions', customOrderInstructions);
    fd.set('media_handling', mediaHandling);
    fd.set('voice_handling', voiceHandling);
    if (requireApproval) fd.set('custom_orders_require_approval', 'on');
    fd.set('knowledge_base_json', JSON.stringify(knowledge));
    fd.set('business_hours_json', JSON.stringify({ tz: timezone, week: hours.week, note: hours.note }));
    fd.set('timezone', timezone);
    if (paymentsEnabled) fd.set('payments_enabled', 'on');
    for (const m of paymentMethods) fd.append('payment_methods', m);
    fd.set('payment_instructions', paymentInstructions);
    fd.set('default_currency', defaultCurrency);
    onFinish(fd);
  }

  const progressPct = Math.round(((step + 1) / STEP_TITLES.length) * 100);

  return (
    <div
      className="space-y-6"
      onKeyDown={(e) => {
        // A stray Enter inside a single-line Input must not skip ahead of Next/Back.
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault();
      }}
    >
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Step {step + 1} of {STEP_TITLES.length}
          </span>
          <span>{STEP_TITLES[step]}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>What kind of business is this?</CardTitle>
            <CardDescription>Product or service. This decides how the AI handles orders vs bookings/quotes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
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
                  type="url"
                  value={bookingLink}
                  onChange={(e) => setBookingLink(e.target.value)}
                  placeholder="https://calendly.com/…"
                />
                <p className="text-xs text-muted-foreground">
                  Set this if customers should book appointments directly, and the AI shares the link instead of
                  collecting details. Leave blank and the AI will collect a quote request for your team to price.
                </p>
              </div>
            )}

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
                      The AI offers real times from your business hours and books them, instead of handing out a link.
                      This replaces the booking link above.
                    </span>
                  </span>
                </label>

                {bookingEnabled && (
                  <div className="flex flex-col gap-3 border-t pt-3">
                    <div className="flex flex-col gap-1.5">
                      <Label>Where do meetings happen?</Label>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => setBookingMode('calcom')}
                          className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                            bookingMode === 'calcom' ? 'border-primary bg-primary/5' : 'border-input'
                          }`}
                        >
                          <span className="block text-sm font-medium">Create a link for me</span>
                          <span className="block text-xs text-muted-foreground">
                            A fresh Google Meet link per booking.
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setBookingMode('own_link')}
                          className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                            bookingMode === 'own_link' ? 'border-primary bg-primary/5' : 'border-input'
                          }`}
                        >
                          <span className="block text-sm font-medium">I have my own</span>
                          <span className="block text-xs text-muted-foreground">
                            Your Zoom/Meet room, or a street address.
                          </span>
                        </button>
                      </div>
                    </div>

                    {bookingMode === 'own_link' && (
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="booking_own_link">Your meeting link or address</Label>
                        <Input
                          id="booking_own_link"
                          value={bookingOwnLink}
                          onChange={(e) => setBookingOwnLink(e.target.value)}
                          placeholder="https://zoom.us/j/… or 12 Main St, Lahore"
                        />
                        <p className="text-xs text-muted-foreground">
                          Shared with every customer who books. A web address becomes a clickable link; anything else is
                          treated as a physical location.
                        </p>
                      </div>
                    )}

                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="booking_duration_minutes">Appointment length</Label>
                        <Input
                          id="booking_duration_minutes"
                          type="number"
                          min={5}
                          step={5}
                          value={bookingDuration}
                          onChange={(e) => setBookingDuration(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">Minutes</p>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="booking_lead_time_minutes">Minimum notice</Label>
                        <Input
                          id="booking_lead_time_minutes"
                          type="number"
                          min={0}
                          step={15}
                          value={bookingLeadTime}
                          onChange={(e) => setBookingLeadTime(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          Minutes. Stops same-minute bookings.
                        </p>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="booking_max_days_ahead">Book up to</Label>
                        <Input
                          id="booking_max_days_ahead"
                          type="number"
                          min={1}
                          value={bookingMaxDays}
                          onChange={(e) => setBookingMaxDays(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">Days ahead</p>
                      </div>
                    </div>

                    {/* Booking silently offers nothing without BOTH of these, and
                        nothing else in the form would tell you — the toggle looks
                        on, the AI just says there's no availability. */}
                    {(() => {
                      const missing = [
                        !timezone && 'a timezone',
                        !hours.week.some((r) => r.open && r.close) && 'opening hours',
                      ].filter(Boolean);
                      return missing.length > 0 ? (
                        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                          Set {missing.join(' and ')} in the Business hours step, or the AI will tell every customer
                          there is no availability.
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Times come from your business hours and timezone. Holiday closures are respected automatically.
                        </p>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Your assistant&apos;s personality</CardTitle>
            <CardDescription>
              Answer a couple of quick things and we&apos;ll write your assistant&apos;s instructions for you. You can
              fine-tune the wording afterwards.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PromptArchitect
              systemPrompt={systemPrompt}
              onSystemPromptChange={setSystemPrompt}
              businessType={businessType}
              catalogueHint={catalogFreeform}
              onGenerate={onGeneratePrompt}
            />
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>What do you sell?</CardTitle>
            <CardDescription>
              List your items, services, or packages in your own words: prices, options, whatever you&apos;d tell a
              customer. We turn this into something your AI assistant can answer questions from.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              rows={8}
              value={catalogFreeform}
              onChange={(e) => setCatalogFreeform(e.target.value)}
              placeholder={
                'e.g. Chocolate cake - Rs 2500, serves 8\nRed velvet cake - Rs 3000, serves 8\nCupcakes - Rs 150 each, minimum order of 6\nFree delivery on orders over Rs 5000'
              }
            />
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Custom orders</CardTitle>
            <CardDescription>Let customers ask for a customised version of one of your items.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="custom_orders_enabled">Enable custom orders</Label>
              <Switch id="custom_orders_enabled" checked={customOrdersEnabled} onCheckedChange={setCustomOrdersEnabled} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="custom_order_instructions">In your own words</Label>
              <Textarea
                id="custom_order_instructions"
                rows={4}
                value={customOrderInstructions}
                onChange={(e) => setCustomOrderInstructions(e.target.value)}
                placeholder="We make custom phone cases; customers can put a name/photo on any model; we can't do glass cases; turnaround 3 days…"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>Photos & voice notes from customers</CardTitle>
            <CardDescription>How should the AI handle a picture, voice note, or video a customer sends as an example?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <p className="mb-2 text-sm font-medium">Photos</p>
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
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Voice notes</p>
              <div className="flex flex-col gap-2">
                {VOICE_HANDLING_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setVoiceHandling(opt.value)}
                    className={`flex flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors ${
                      voiceHandling === opt.value ? 'border-primary bg-primary/5' : 'border-input'
                    }`}
                  >
                    <span className="text-sm font-medium">{opt.label}</span>
                    <span className="text-xs text-muted-foreground">{opt.hint}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Videos are always held for a human to review. There&apos;s no auto-answer option for those yet.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 5 && (
        <Card>
          <CardHeader>
            <CardTitle>Order approval</CardTitle>
            <CardDescription>Should custom orders need your sign-off before they&apos;re final?</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Approve each custom order before it&apos;s final</p>
                <p className="text-xs text-muted-foreground">Off = auto-send finalised orders straight to you.</p>
              </div>
              <Switch checked={requireApproval} onCheckedChange={setRequireApproval} />
            </div>
          </CardContent>
        </Card>
      )}

      {step === 6 && (
        <Card>
          <CardHeader>
            <CardTitle>Common questions</CardTitle>
            <CardDescription>
              Answers the AI can give straight away: delivery, returns, location, and common questions, in your own
              words.
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
                  <Textarea rows={2} value={entry.a} onChange={(e) => updateFaq(i, { a: e.target.value })} placeholder="Answer" />
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
          </CardContent>
        </Card>
      )}

      {step === 7 && (
        <Card>
          <CardHeader>
            <CardTitle>Business hours</CardTitle>
            <CardDescription>
              So the AI can answer &quot;are you open right now?&quot; accurately. Leave a day&apos;s times blank for closed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="timezone">Timezone</Label>
              <select
                id="timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
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
              <p className="text-xs text-muted-foreground">
                Used for &quot;are you open now?&quot; and, if booking is on, for every appointment time.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {hours.week.map((row) => (
                <div key={row.day} className="flex items-center gap-2">
                  <span className="w-10 text-sm font-medium">{row.day}</span>
                  <Input type="time" value={row.open} onChange={(e) => updateHourRow(row.day, { open: e.target.value })} />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input type="time" value={row.close} onChange={(e) => updateHourRow(row.day, { close: e.target.value })} />
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
          </CardContent>
        </Card>
      )}

      {step === 8 && (
        <Card>
          <CardHeader>
            <CardTitle>Payments</CardTitle>
            <CardDescription>How customers pay, and what the AI is allowed to tell them about it.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Enable payments</p>
                <p className="text-xs text-muted-foreground">Off = the AI never mentions payment methods or totals.</p>
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
                </div>
                {paymentMethods.includes('manual_transfer') && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="payment_instructions">Bank/wallet details</Label>
                    <Textarea
                      id="payment_instructions"
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
                    className="h-9 max-w-[16rem] rounded-md border border-input bg-transparent px-3 text-sm"
                    value={defaultCurrency}
                    onChange={(e) => setDefaultCurrency(e.target.value)}
                  >
                    {/* A stored value outside the shortlist is kept as an option
                        rather than silently rewritten to PKR on the next save. */}
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
              </>
            )}
          </CardContent>
        </Card>
      )}

      {submitError && <p className="text-sm text-destructive">{submitError}</p>}

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          Back
        </Button>
        {step < LAST_STEP ? (
          <Button type="button" onClick={() => setStep((s) => Math.min(LAST_STEP, s + 1))}>
            Next
          </Button>
        ) : (
          <Button type="button" onClick={handleFinish} disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : finishLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
