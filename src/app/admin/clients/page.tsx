import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { EditClientDialog } from './edit-client-dialog';
import { InviteClientDialog } from './[id]/invite/invite-client-dialog';
import { NewClientDialog } from './new-client-dialog';
import { QuickProvisionDialog } from './quick-provision-dialog';
import { OffboardTenantDialog } from './offboard-tenant-dialog';
import { log } from '@/lib/log';

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  facebook: 'Messenger',
  instagram: 'Instagram',
  web: 'Website chat',
};

export default async function ClientsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: tenants, error } = await supabase
    .from('tenants')
    .select(
      'id, business_name, slug, meta_page_id, instagram_id, whatsapp_phone_number_id, widget_public_key, widget_allowed_origins, system_prompt, catalog_data, is_active, created_at, openai_key_secret_id, meta_token_secret_id, whatsapp_token_secret_id, requested_platforms, platform_setup_notes, platform_setup_requested_at, business_type, booking_enabled, booking_mode, booking_own_link, booking_duration_minutes',
    )
    .order('created_at', { ascending: false });

  if (error) {
    log.error('[admin/clients] tenants lookup failed', error.message);
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Clients"
        description="Manage tenant businesses and their channels."
        actions={
          <div className="flex items-center gap-2">
            <NewClientDialog />
            <QuickProvisionDialog />
          </div>
        }
      />

      <div className="rounded-xl bg-card ring-1 ring-foreground/10 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Business</TableHead>
              <TableHead>Channels</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(tenants ?? []).map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">
                  {t.business_name}
                  {t.slug && <span className="ml-2 text-xs text-muted-foreground">/{t.slug}</span>}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {t.whatsapp_phone_number_id && <Badge variant="secondary">WhatsApp</Badge>}
                    {t.meta_page_id && <Badge variant="secondary">Messenger</Badge>}
                    {t.instagram_id && <Badge variant="secondary">Instagram</Badge>}
                    {t.widget_public_key && <Badge variant="secondary">Web</Badge>}
                    {t.requested_platforms.length > 0 && (
                      <Badge
                        variant="outline"
                        className="border-amber-500 text-amber-600"
                        title={
                          (t.platform_setup_notes ? `"${t.platform_setup_notes}" — ` : '') +
                          (t.platform_setup_requested_at
                            ? `requested ${new Date(t.platform_setup_requested_at).toLocaleDateString()}`
                            : '')
                        }
                      >
                        Setup requested: {t.requested_platforms.map((p) => CHANNEL_LABELS[p] ?? p).join(', ')}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {t.is_active ? <Badge>Active</Badge> : <Badge variant="outline">Inactive</Badge>}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(t.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Link
                      href={`/admin/clients/${t.id}/intake`}
                      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                    >
                      Intake
                    </Link>
                    <EditClientDialog tenant={t} />
                    <InviteClientDialog tenantId={t.id} businessName={t.business_name} />
                    <OffboardTenantDialog tenantId={t.id} businessName={t.business_name} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {error && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-destructive">
                  Couldn&apos;t load clients. Please refresh and try again.
                </TableCell>
              </TableRow>
            )}
            {!error && (!tenants || tenants.length === 0) && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No clients yet. Create your first one.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
