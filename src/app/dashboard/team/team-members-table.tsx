'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { TeamMember } from '@/services/teamMembers';
import { changeMemberRoleAction, removeMemberAction } from './actions';

const ROLE_LABEL: Record<string, string> = {
  tenant_admin: 'Admin',
  tenant_agent: 'Team member',
  platform_admin: 'Platform admin',
};

export function TeamMembersTable({
  tenantId,
  members,
  currentUserId,
}: {
  tenantId: string;
  members: TeamMember[];
  currentUserId: string;
}) {
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null);
  const [isPending, startTransition] = useTransition();
  const adminCount = members.filter((m) => m.role === 'tenant_admin').length;

  function handleChangeRole(member: TeamMember, newRole: 'tenant_admin' | 'tenant_agent') {
    startTransition(async () => {
      const result = await changeMemberRoleAction(tenantId, member.userId, newRole);
      if (result.error) toast.error(result.error);
      else toast.success(`${member.fullName ?? member.email ?? 'Member'} is now ${ROLE_LABEL[newRole].toLowerCase()}.`);
    });
  }

  function handleRemove() {
    if (!removeTarget) return;
    const target = removeTarget;
    startTransition(async () => {
      const result = await removeMemberAction(tenantId, target.userId);
      if (result.error) toast.error(result.error);
      else toast.success(`${target.fullName ?? target.email ?? 'Member'} removed from the team.`);
      setRemoveTarget(null);
    });
  }

  return (
    <>
      <div className="rounded-xl bg-card ring-1 ring-foreground/10 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => {
              const isLastAdmin = member.role === 'tenant_admin' && adminCount <= 1;
              const isSelf = member.userId === currentUserId;
              const manageable = member.role !== 'platform_admin';
              return (
                <TableRow key={member.userId}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {member.fullName ?? member.email ?? 'Pending'}
                        {isSelf && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}
                      </span>
                      {member.fullName && member.email && (
                        <span className="text-xs text-muted-foreground">{member.email}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={member.role === 'tenant_admin' ? 'default' : 'secondary'}>
                      {ROLE_LABEL[member.role] ?? member.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(member.joinedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {manageable && (
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
                          <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {member.role === 'tenant_admin' ? (
                            <DropdownMenuItem
                              disabled={isPending || isLastAdmin}
                              onClick={() => handleChangeRole(member, 'tenant_agent')}
                            >
                              Make team member
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              disabled={isPending}
                              onClick={() => handleChangeRole(member, 'tenant_admin')}
                            >
                              Make admin
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={isPending || isLastAdmin}
                            onClick={() => setRemoveTarget(member)}
                          >
                            Remove from team
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {members.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No team members yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={removeTarget !== null} onOpenChange={(next) => !next && setRemoveTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove {removeTarget?.fullName ?? removeTarget?.email ?? 'this member'}?</DialogTitle>
            <DialogDescription>
              They&apos;ll lose access to this dashboard immediately. You can invite them again later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRemoveTarget(null)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={handleRemove} disabled={isPending}>
              {isPending ? 'Removing…' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
