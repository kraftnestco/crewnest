'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
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
import { eraseCustomerAction } from '@/app/admin/chat/actions';

/**
 * Right-to-erasure trigger for a single customer (docs/17 §4.2, Stage T). Deletes their
 * session, media, and PII on their orders — irreversible. The session row's own deletion
 * propagates to the inbox via Realtime, so no local "session gone" handling is needed here.
 */
export function EraseCustomerDialog({ sessionId, customerLabel }: { sessionId: string; customerLabel: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleErase() {
    startTransition(async () => {
      try {
        await eraseCustomerAction(sessionId);
        toast.success('Customer data erased.');
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to erase customer data.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="destructive" size="sm" className="w-full justify-start gap-1.5" />}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Erase customer data
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Erase {customerLabel}&apos;s data?</DialogTitle>
          <DialogDescription>
            This permanently deletes this conversation and its media, and clears this customer&apos;s name, phone,
            and address from their past orders. Order records themselves are kept. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={handleErase} disabled={isPending}>
            {isPending ? 'Erasing…' : 'Erase data'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
