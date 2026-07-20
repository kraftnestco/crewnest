import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BUSINESS_TYPE_OPTIONS,
  MEDIA_HANDLING_OPTIONS,
  parseBusinessHours,
  parseKnowledgeBase,
  type IntakeTenant,
} from '@/components/intake/intake-shared';

function truncate(text: string, max = 140): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/** Read-only recap of a completed intake, shown once the wizard has been finished. */
export function IntakeSummary({ tenant, onEdit }: { tenant: IntakeTenant; onEdit: () => void }) {
  const businessType = BUSINESS_TYPE_OPTIONS.find((o) => o.value === tenant.business_type)?.label ?? tenant.business_type;
  const mediaHandling =
    MEDIA_HANDLING_OPTIONS.find((o) => o.value === tenant.media_handling)?.label ?? tenant.media_handling ?? '—';
  const knowledge = parseKnowledgeBase(tenant.knowledge_base);
  const hours = parseBusinessHours(tenant.business_hours);
  const openDays = hours.week.filter((d) => d.open && d.close);

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Business type', value: businessType },
    { label: 'About your business', value: tenant.system_prompt ? truncate(tenant.system_prompt) : '—' },
    { label: 'What you sell', value: tenant.catalog_freeform_text ? truncate(tenant.catalog_freeform_text) : '—' },
    {
      label: 'Custom orders',
      value: tenant.custom_orders_enabled
        ? `On${tenant.custom_orders_require_approval ? ' — needs your approval' : ' — auto-sent'}`
        : 'Off',
    },
    { label: 'Customer example media', value: mediaHandling },
    {
      label: 'Common questions',
      value: knowledge.faq.length ? `${knowledge.faq.length} FAQ entr${knowledge.faq.length === 1 ? 'y' : 'ies'} saved` : 'None yet',
    },
    {
      label: 'Business hours',
      value: openDays.length ? `Open ${openDays.length} day${openDays.length === 1 ? '' : 's'}/week` : 'Not set',
    },
    {
      label: 'Payments',
      value: tenant.payments_enabled
        ? `On — ${tenant.payment_methods.join(', ') || 'no method selected'} (${tenant.default_currency})`
        : 'Off',
    },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle>Business details</CardTitle>
        <Button type="button" variant="outline" size="sm" onClick={onEdit}>
          Edit
        </Button>
      </CardHeader>
      <CardContent>
        <dl className="divide-y divide-border">
          {rows.map((row) => (
            <div key={row.label} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
              <dt className="w-full shrink-0 text-xs font-medium text-muted-foreground sm:w-44">{row.label}</dt>
              <dd className="text-sm">{row.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
