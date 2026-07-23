import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCallerContext, resolveActiveTenant } from '@/lib/auth/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/page-header';
import { listTeamMembers } from '@/services/teamMembers';
import { InviteTeamMemberDialog } from './invite-team-member-dialog';
import { TeamMembersTable } from './team-members-table';

export default async function DashboardTeamPage() {
  const ctx = await getCallerContext(); // layout already gated; re-derive (React cache dedupes)
  if (!ctx) redirect('/login');
  const cookieStore = await cookies();
  const activeTenantId = resolveActiveTenant(ctx, cookieStore.get('cn_active_tenant')?.value);
  if (!activeTenantId) redirect('/dashboard');

  const activeMembership = ctx.memberships.find((m) => m.tenantId === activeTenantId);
  if (activeMembership?.role !== 'tenant_admin') {
    // Staff (tenant_agent) get no team UI (docs/18 §5 guardrail 1).
    redirect('/dashboard');
  }

  const supabase = await createSupabaseServerClient();
  const { data: tenant } = await supabase.from('tenants').select('business_name').eq('id', activeTenantId).single();
  if (!tenant) redirect('/dashboard');

  const members = await listTeamMembers(activeTenantId);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <PageHeader
        title="My Team"
        description={`Manage who at ${tenant.business_name} can access this dashboard.`}
        actions={<InviteTeamMemberDialog tenantId={activeTenantId} />}
      />
      <TeamMembersTable tenantId={activeTenantId} members={members} currentUserId={ctx.userId} />
    </div>
  );
}
