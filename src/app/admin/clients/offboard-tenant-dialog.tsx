'use client';

import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { offboardTenantAction } from './actions';
import { initialOffboardTenantState } from './action-state';

/**
 * Tenant offboarding / right-to-erasure (docs/17 §4.1, Stage T) — irreversible: deletes
 * every session/message/order for this tenant, their media, their Vault secrets, and the
 * tenant row itself. Gated behind typing the exact business name, same weight as any
 * "delete account" flow elsewhere.
 */
export function OffboardTenantDialog({ tenantId, businessName }: { tenantId: string; businessName: string }) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const boundAction = offboardTenantAction.bind(null, tenantId);
  const [state, formAction, isPending] = useActionState(boundAction, initialOffboardTenantState);

  useEffect(() => {
    if (state.success) {
      toast.success(`${businessName} offboarded. All data erased.`);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- closing the dialog is a reaction to the action result, not a render-time state sync
      setOpen(false);
    }
  }, [state, businessName]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setConfirmText('');
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="destructive" size="sm" />}>Offboard</DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form action={formAction} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Offboard {businessName}?</DialogTitle>
            <DialogDescription>
              This permanently deletes every conversation, order, media file, and secret for this client, then the
              client itself. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm_name">
              Type <span className="font-semibold">{businessName}</span> to confirm
            </Label>
            <Input
              id="confirm_name"
              name="confirm_name"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
            />
          </div>

          {state.error && <p className="text-sm text-destructive">{state.error}</p>}

          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={isPending || confirmText !== businessName}>
              {isPending ? 'Offboarding…' : 'Offboard & erase all data'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
