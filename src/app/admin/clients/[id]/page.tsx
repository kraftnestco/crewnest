import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format-date';
import { PageHeader } from '@/components/page-header';
import { pruneRequestedPlatforms } from '@/lib/channels';
import { EditClientDialog } from '../edit-client-dialog';
import { InviteClientDialog } from './invite/invite-client-dialog';
import { OffboardTenantDialog } from '../offboard-tenant-dialog';

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  facebook: 'Messenger',
  instagram: 'Instagram',
  web: 'Website chat',
};

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: tenant } = await supabase
    .from('tenants')
    .select(
      'id, business_name, slug, meta_page_id, instagram_id, whatsapp_phone_number_id, widget_public_key, widget_allowed_origins, system_prompt, catalog_data, is_active, created_at, openai_key_secret_id, meta_token_secret_id, whatsapp_token_secret_id, requested_platforms, platform_setup_notes, platform_setup_requested_at, business_type, booking_enabled, booking_mode, booking_own_link, booking_duration_minutes, plan, plan_status, billing_country',
    )
    .eq('id', id)
    .maybeSingle();

  if (!tenant) notFound();

  const outstanding = pruneRequestedPlatforms(tenant.requested_platforms, {
    whatsapp: Boolean(tenant.whatsapp_phone_number_id),
    facebook: Boolean(tenant.meta_page_id),
    instagram: Boolean(tenant.instagram_id),
    web: Boolean(tenant.widget_public_key),
  });

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <div>
        <Link href="/admin/clients" className="text-xs text-muted-foreground underline underline-offset-2">
          ← Clients
        </Link>
        <PageHeader
          title={tenant.business_name}
          description={tenant.slug ? `/${tenant.slug}` : 'Client workspace'}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/admin/clients/${tenant.id}/intake`}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              >
                Intake
              </Link>
              <EditClientDialog tenant={tenant} />
              <InviteClientDialog tenantId={tenant.id} businessName={tenant.business_name} />
              <OffboardTenantDialog tenantId={tenant.id} businessName={tenant.business_name} />
            </div>
          }
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {tenant.is_active ? <Badge>Active</Badge> : <Badge variant="outline">Inactive</Badge>}
        <Badge variant="secondary">{tenant.plan}</Badge>
        {tenant.plan_status && <Badge variant="outline">{tenant.plan_status}</Badge>}
        {tenant.billing_country && <Badge variant="outline">{tenant.billing_country}</Badge>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Channels</CardTitle>
          <CardDescription>Live destinations and outstanding setup requests.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1">
            {tenant.whatsapp_phone_number_id && <Badge variant="secondary">WhatsApp</Badge>}
            {tenant.meta_page_id && <Badge variant="secondary">Messenger</Badge>}
            {tenant.instagram_id && <Badge variant="secondary">Instagram</Badge>}
            {tenant.widget_public_key && <Badge variant="secondary">Web</Badge>}
            {!tenant.whatsapp_phone_number_id &&
              !tenant.meta_page_id &&
              !tenant.instagram_id &&
              !tenant.widget_public_key && (
                <p className="text-sm text-muted-foreground">No channels connected yet.</p>
              )}
          </div>
          {outstanding.length > 0 && (
            <p className="text-sm">
              Setup requested:{' '}
              {outstanding.map((p) => CHANNEL_LABELS[p] ?? p).join(', ')}
              {tenant.platform_setup_requested_at
                ? ` (${formatDate(tenant.platform_setup_requested_at)})`
                : ''}
            </p>
          )}
          {tenant.platform_setup_notes && (
            <p className="text-sm text-muted-foreground">Notes: {tenant.platform_setup_notes}</p>
          )}
          {tenant.widget_public_key && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Widget public key</p>
              <code className="block break-all rounded-md bg-muted px-2 py-1 text-xs">{tenant.widget_public_key}</code>
              {tenant.widget_allowed_origins.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Origins: {tenant.widget_allowed_origins.join(', ')}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
