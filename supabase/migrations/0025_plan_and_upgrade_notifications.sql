-- Self-serve signup + free plan (docs: "try it for your business" plan, Phase C).
-- plan/plan_status are app-validated allow-lists (like business_type/media_handling),
-- not DB enums, since tiers may change without a migration.
alter table public.tenants
  add column if not exists plan text not null default 'free',
  add column if not exists plan_status text;

-- Add 'upgrade_request' to the notification type allow-list (0023) for the
-- paid-plan self-serve signup path notifying the agency.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'new_order','handoff','alert_signal','channel_request','payment_proof','upgrade_request'
  ));
