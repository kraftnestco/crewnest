import { createSupabaseServerClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import { DEFAULT_LLM_MODEL, DEFAULT_LLM_PROVIDER, WIDGET_RATE_LIMIT } from '@/lib/constants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: admins, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, is_platform_admin, created_at')
    .eq('is_platform_admin', true)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[admin/settings] platform admins lookup failed', error.message);
  }

  const systemInfo = [
    { label: 'Default LLM provider / model', value: `${DEFAULT_LLM_PROVIDER} / ${DEFAULT_LLM_MODEL}` },
    { label: 'Meta Graph API version', value: env.META_GRAPH_VERSION },
    { label: 'App URL', value: env.NEXT_PUBLIC_APP_URL },
    { label: 'Widget rate limit', value: `${WIDGET_RATE_LIMIT.max} requests / ${WIDGET_RATE_LIMIT.windowMs / 1000}s` },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="font-heading text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Agency-level configuration and access.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-normal text-muted-foreground">System info</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {systemInfo.map((row) => (
              <div key={row.label} className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{row.label}</dt>
                <dd className="text-sm font-medium">{row.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-2 font-heading text-sm font-semibold">Platform admins</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Access is granted from the Supabase dashboard (Auth → add user, then set{' '}
          <code className="rounded bg-muted px-1 py-0.5">is_platform_admin = true</code> on their
          profile row).
        </p>
        <div className="rounded-xl bg-card ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(admins ?? []).map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">
                    {a.full_name || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{a.email}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(a.created_at).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
              {error && (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-destructive">
                    Couldn&apos;t load platform admins — please refresh and try again.
                  </TableCell>
                </TableRow>
              )}
              {!error && (!admins || admins.length === 0) && (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                    No platform admins found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Badge variant="outline" className="text-xs">
        Client self-serve settings (retention, prompt/catalogue editing by tenant admins) ship in Phase 2.
      </Badge>
    </div>
  );
}
