import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { IntakeForm } from './intake-form';

export default async function ClientIntakePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: tenant } = await supabase
    .from('tenants')
    .select(
      'id, business_name, system_prompt, catalog_data, custom_orders_enabled, custom_orders_require_approval, custom_order_instructions, media_handling, business_type, booking_link, knowledge_base, business_hours, timezone, payments_enabled, payment_methods, payment_instructions, default_currency, prepaid_required',
    )
    .eq('id', id)
    .maybeSingle();

  if (!tenant) notFound();

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/admin/clients" className="text-xs text-muted-foreground underline underline-offset-2">
          ← Clients
        </Link>
        <h1 className="font-heading text-xl font-semibold">Intake — {tenant.business_name}</h1>
        <p className="text-sm text-muted-foreground">
          Configure how the AI describes this business, its catalogue, and how it handles custom orders and
          customer-sent example media.
        </p>
      </div>
      <IntakeForm tenant={tenant} />
    </div>
  );
}
