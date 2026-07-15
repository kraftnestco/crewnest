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
import { Textarea } from '@/components/ui/textarea';
import { createTenantAction } from './actions';
import { initialCreateTenantState } from './action-state';

export function NewClientDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(createTenantAction, initialCreateTenantState);

  useEffect(() => {
    if (state.success) {
      toast.success(`Client created. Widget key: ${state.widgetPublicKey}`);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- closing the dialog is a reaction to the action result, not a render-time state sync
      setOpen(false);
    }
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>New client</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={formAction} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New client</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="business_name">Business name</Label>
              <Input id="business_name" name="business_name" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="slug">Slug</Label>
              <Input id="slug" name="slug" placeholder="acme-co" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="widget_allowed_origins">Widget allowed origins</Label>
              <Input id="widget_allowed_origins" name="widget_allowed_origins" placeholder="https://acme.com" />
              <p className="text-xs text-muted-foreground">
                Comma-separated. The website widget rejects every request until at least one origin is set here.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="whatsapp_phone_number_id">WhatsApp phone number id</Label>
              <Input id="whatsapp_phone_number_id" name="whatsapp_phone_number_id" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="meta_page_id">Meta page id</Label>
              <Input id="meta_page_id" name="meta_page_id" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="instagram_id">Instagram account id</Label>
              <Input id="instagram_id" name="instagram_id" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="openai_byok_key">OpenAI key (BYOK, optional)</Label>
              <Input id="openai_byok_key" name="openai_byok_key" type="password" autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="meta_page_token">Meta page token</Label>
              <Input id="meta_page_token" name="meta_page_token" type="password" autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="whatsapp_token">WhatsApp token</Label>
              <Input id="whatsapp_token" name="whatsapp_token" type="password" autoComplete="off" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="system_prompt">System prompt</Label>
            <Textarea
              id="system_prompt"
              name="system_prompt"
              rows={3}
              placeholder="You are the AI assistant for…"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="catalog_data">Catalogue (JSON)</Label>
            <Textarea id="catalog_data" name="catalog_data" rows={4} placeholder="{ }" />
          </div>

          {state.error && <p className="text-sm text-destructive">{state.error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Creating…' : 'Create client'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
