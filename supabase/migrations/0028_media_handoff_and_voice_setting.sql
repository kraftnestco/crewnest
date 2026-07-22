alter table public.chat_sessions
  add column if not exists pending_clarification jsonb;

alter table public.tenants
  add column if not exists voice_handling text not null default 'human_review';

alter table public.tenants drop constraint if exists tenants_voice_handling_check;
alter table public.tenants add constraint tenants_voice_handling_check
  check (voice_handling in ('ai_autonomous', 'human_review'));

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'new_order','handoff','alert_signal','channel_request','payment_proof',
    'upgrade_request','review','order_updated','media_review'
  ));
