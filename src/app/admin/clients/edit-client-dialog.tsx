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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { Database } from '@/types/database';
import { updateTenantAction } from './actions';
import { initialUpdateTenantState } from './action-state';

type EditableTenant = Pick<
  Database['public']['Tables']['tenants']['Row'],
  | 'id'
  | 'business_name'
  | 'slug'
  | 'meta_page_id'
  | 'instagram_id'
  | 'whatsapp_phone_number_id'
  | 'system_prompt'
  | 'catalog_data'
  | 'widget_allowed_origins'
  | 'is_active'
  | 'openai_key_secret_id'
  | 'meta_token_secret_id'
  | 'whatsapp_token_secret_id'
  | 'business_type'
  | 'booking_enabled'
  | 'booking_mode'
  | 'booking_own_link'
  | 'booking_duration_minutes'
>;

export function EditClientDialog({ tenant }: { tenant: EditableTenant }) {
  const [open, setOpen] = useState(false);
  // Appointment booking (docs/24) is service-only — the tools are gated on
  // businessType === 'service', so showing this for a product business would
  // offer a switch that does nothing. The server action enforces it too.
  const isService = tenant.business_type === 'service';
  const [bookingEnabled, setBookingEnabled] = useState(tenant.booking_enabled ?? false);
  const [bookingMode, setBookingMode] = useState(tenant.booking_mode ?? 'calcom');
  const boundAction = updateTenantAction.bind(null, tenant.id);
  const [state, formAction, isPending] = useActionState(boundAction, initialUpdateTenantState);

  useEffect(() => {
    if (state.success) {
      toast.success('Client updated.');
      // eslint-disable-next-line react-hooks/set-state-in-effect -- closing the dialog is a reaction to the action result, not a render-time state sync
      setOpen(false);
    }
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Edit</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={formAction} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Edit {tenant.business_name}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="business_name">Business name</Label>
              <Input id="business_name" name="business_name" defaultValue={tenant.business_name} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="slug">Slug</Label>
              <Input id="slug" name="slug" defaultValue={tenant.slug ?? ''} placeholder="acme-co" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="widget_allowed_origins">Widget allowed origins</Label>
              <Input
                id="widget_allowed_origins"
                name="widget_allowed_origins"
                defaultValue={(tenant.widget_allowed_origins ?? []).join(', ')}
                placeholder="https://acme.com"
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated. The website widget rejects every request until at least one origin is set here.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="whatsapp_phone_number_id">WhatsApp phone number id</Label>
              <Input
                id="whatsapp_phone_number_id"
                name="whatsapp_phone_number_id"
                defaultValue={tenant.whatsapp_phone_number_id ?? ''}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="meta_page_id">Meta page id</Label>
              <Input id="meta_page_id" name="meta_page_id" defaultValue={tenant.meta_page_id ?? ''} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="instagram_id">Instagram account id</Label>
              <Input id="instagram_id" name="instagram_id" defaultValue={tenant.instagram_id ?? ''} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="openai_byok_key">
                OpenAI key (BYOK) {tenant.openai_key_secret_id && <span className="text-muted-foreground">•••• set</span>}
              </Label>
              <Input
                id="openai_byok_key"
                name="openai_byok_key"
                type="password"
                autoComplete="off"
                placeholder={tenant.openai_key_secret_id ? 'Leave blank to keep current' : ''}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="meta_page_token">
                Meta page token {tenant.meta_token_secret_id && <span className="text-muted-foreground">•••• set</span>}
              </Label>
              <Input
                id="meta_page_token"
                name="meta_page_token"
                type="password"
                autoComplete="off"
                placeholder={tenant.meta_token_secret_id ? 'Leave blank to keep current' : ''}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="whatsapp_token">
                WhatsApp token {tenant.whatsapp_token_secret_id && <span className="text-muted-foreground">•••• set</span>}
              </Label>
              <Input
                id="whatsapp_token"
                name="whatsapp_token"
                type="password"
                autoComplete="off"
                placeholder={tenant.whatsapp_token_secret_id ? 'Leave blank to keep current' : ''}
              />
            </div>
          </div>

          {/* Appointment booking (docs/24) — service businesses only. */}
          {isService && (
            <div className="flex flex-col gap-3 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="booking_enabled">Book appointments in chat</Label>
                  <p className="text-xs text-muted-foreground">
                    The AI offers real times from this business&apos;s hours and books them.
                  </p>
                </div>
                <Switch
                  id="booking_enabled"
                  name="booking_enabled"
                  checked={bookingEnabled}
                  onCheckedChange={setBookingEnabled}
                />
              </div>

              {bookingEnabled && (
                <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="booking_mode">Meeting location</Label>
                    <select
                      id="booking_mode"
                      name="booking_mode"
                      value={bookingMode}
                      onChange={(e) => setBookingMode(e.target.value)}
                      className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                    >
                      <option value="calcom">Create a link per booking</option>
                      <option value="own_link">Their own link / address</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="booking_duration_minutes">Length (minutes)</Label>
                    <Input
                      id="booking_duration_minutes"
                      name="booking_duration_minutes"
                      type="number"
                      min={5}
                      step={5}
                      defaultValue={tenant.booking_duration_minutes ?? 30}
                    />
                  </div>
                  {bookingMode === 'own_link' && (
                    <div className="col-span-full flex flex-col gap-1.5">
                      <Label htmlFor="booking_own_link">Meeting link or address</Label>
                      <Input
                        id="booking_own_link"
                        name="booking_own_link"
                        defaultValue={tenant.booking_own_link ?? ''}
                        placeholder="https://zoom.us/j/… or 12 Main St, Lahore"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="system_prompt">System prompt</Label>
            <Textarea
              id="system_prompt"
              name="system_prompt"
              rows={3}
              defaultValue={tenant.system_prompt}
              placeholder="You are the AI assistant for…"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="catalog_data">Catalogue (JSON)</Label>
            <Textarea
              id="catalog_data"
              name="catalog_data"
              rows={4}
              defaultValue={JSON.stringify(tenant.catalog_data ?? {}, null, 2)}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="is_active">Active</Label>
            <Switch id="is_active" name="is_active" defaultChecked={tenant.is_active} />
          </div>

          {state.error && <p className="text-sm text-destructive">{state.error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
