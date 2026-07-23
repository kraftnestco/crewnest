'use client';

import { useActionState, useState } from 'react';
import { toast } from 'sonner';
import { Check, Copy, Sparkles, TriangleAlert } from 'lucide-react';
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
import { quickProvisionAction } from './quick-provision-actions';
import { initialQuickProvisionState } from './quick-provision-state';

/**
 * O4 — the one-form "provision a client in minutes" front door. On submit it
 * runs {@link quickProvisionAction} (create + optional Magic Import + optional
 * invite) and swaps to a success screen showing the widget key (copy-out) and
 * any non-fatal warnings. The manual {@link NewClientDialog} stays as the
 * advanced/precise path.
 */
export function QuickProvisionDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(quickProvisionAction, initialQuickProvisionState);

  function copyKey() {
    if (!state.widgetPublicKey) return;
    void navigator.clipboard.writeText(state.widgetPublicKey);
    toast.success('Widget key copied.');
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Sparkles className="mr-1.5 h-4 w-4" />
        Quick provision
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        {state.success ? (
          <div className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Check className="h-5 w-5 text-emerald-500" />
                Client provisioned
              </DialogTitle>
              <DialogDescription>{state.summary}</DialogDescription>
            </DialogHeader>

            {state.widgetPublicKey && (
              <div className="flex flex-col gap-1.5">
                <Label>Website widget key</Label>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-xs">
                    {state.widgetPublicKey}
                  </code>
                  <Button type="button" variant="outline" size="sm" onClick={copyKey}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}

            {state.warnings.length > 0 && (
              <ul className="flex flex-col gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                {state.warnings.map((w, i) => (
                  <li key={i} className="flex gap-2">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            )}

            <DialogFooter>
              <Button type="button" onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form action={formAction} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Quick provision a client</DialogTitle>
              <DialogDescription>
                One form: create the client, pre-fill their profile from their website, and invite their
                login, all in one step.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qp_business_name">Business name</Label>
              <Input id="qp_business_name" name="business_name" required placeholder="Acme Cakes" />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qp_import_url">
                Website or social link <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input id="qp_import_url" name="import_url" type="url" placeholder="https://acmecakes.com" />
              <p className="text-xs text-muted-foreground">
                We read the page and pre-fill their persona, catalogue, and FAQs. Nothing is invented, and you
                can edit it all in the intake.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qp_client_email">
                Client login email <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input id="qp_client_email" name="client_email" type="email" placeholder="owner@acmecakes.com" />
              <p className="text-xs text-muted-foreground">
                Sends them a login invite so they can manage their own assistant.
              </p>
            </div>

            <details className="rounded-md border border-foreground/10 p-3">
              <summary className="cursor-pointer text-sm font-medium">Channel details (optional)</summary>
              <div className="mt-3 grid gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="qp_slug">Slug</Label>
                  <Input id="qp_slug" name="slug" placeholder="acme-cakes" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="qp_origins">Widget allowed origins</Label>
                  <Input id="qp_origins" name="widget_allowed_origins" placeholder="https://acmecakes.com" />
                  <p className="text-xs text-muted-foreground">
                    Comma-separated. The website widget rejects requests until at least one origin is set.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="qp_wa">WhatsApp phone number id</Label>
                  <Input id="qp_wa" name="whatsapp_phone_number_id" />
                </div>
              </div>
            </details>

            {state.error && <p className="text-sm text-destructive">{state.error}</p>}

            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Provisioning…' : 'Provision client'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
