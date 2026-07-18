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
import { inviteClientLoginAction } from './actions';
import { initialInviteClientState } from './invite-state';

export function InviteClientDialog({ tenantId, businessName }: { tenantId: string; businessName: string }) {
  const [open, setOpen] = useState(false);
  const boundAction = inviteClientLoginAction.bind(null, tenantId);
  const [state, formAction, isPending] = useActionState(boundAction, initialInviteClientState);

  useEffect(() => {
    if (state.success) {
      toast.success(
        state.alreadyRegistered
          ? `This email is already registered — added to ${businessName}. They can sign in, or use "Forgot password" on the login page if needed.`
          : 'Login invite sent.',
      );
      // eslint-disable-next-line react-hooks/set-state-in-effect -- closing the dialog is a reaction to the action result, not a render-time state sync
      setOpen(false);
    }
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Invite</DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form action={formAction} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Invite a login for {businessName}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required placeholder="owner@business.com" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role">Role</Label>
            <select
              id="role"
              name="role"
              defaultValue="tenant_admin"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="tenant_admin">Business owner (full access + My Business)</option>
              <option value="tenant_agent">Staff (inbox + orders only)</option>
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
