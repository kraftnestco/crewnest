'use client';

import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { inviteTeamMemberAction } from './actions';
import { initialInviteTeamMemberState } from './action-state';

export function InviteTeamMemberDialog({ tenantId }: { tenantId: string }) {
  const [open, setOpen] = useState(false);
  const boundAction = inviteTeamMemberAction.bind(null, tenantId);
  const [state, formAction, isPending] = useActionState(boundAction, initialInviteTeamMemberState);

  useEffect(() => {
    if (state.success) {
      toast.success(
        state.resent
          ? 'Their previous invite had gone stale — sent a fresh code.'
          : state.alreadyRegistered
            ? 'This email is already registered — added to your team.'
            : 'Invite sent.',
      );
      // eslint-disable-next-line react-hooks/set-state-in-effect -- closing the dialog is a reaction to the action result, not a render-time state sync
      setOpen(false);
    }
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>Invite teammate</DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form action={formAction} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Invite a teammate</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="team-invite-email">Email</Label>
            <Input id="team-invite-email" name="email" type="email" required placeholder="teammate@business.com" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="team-invite-role">Role</Label>
            <select
              id="team-invite-role"
              name="role"
              defaultValue="tenant_agent"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="tenant_agent">Team member (inbox + orders only)</option>
              <option value="tenant_admin">Admin (full access, can manage the team)</option>
            </select>
          </div>

          {state.error && <p className="text-sm text-destructive">{state.error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Sending…' : 'Send invite'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
