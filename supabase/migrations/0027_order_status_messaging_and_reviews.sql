-- Order status/payment transitions now message the customer (all but 'confirmed' were
-- previously silent DB writes — see admin/orders/actions.ts). This adds: (1) an
-- append-only status/payment transition log on orders; (2) post-fulfillment review
-- columns plus the chat_sessions pointer submit_review validates against; (3) two new
-- notification types ('review', 'order_updated') added to the existing allow-list
-- (mirrors 0025's drop/add-constraint pattern). All additive alter table on existing
-- tables with existing RLS — no new table, no new policy.

alter table public.orders
  add column if not exists status_history       jsonb not null default '[]'::jsonb,
  add column if not exists review_rating         smallint,
  add column if not exists review_text           text,
  add column if not exists review_requested_at   timestamptz,
  add column if not exists review_submitted_at   timestamptz;

alter table public.orders drop constraint if exists orders_review_rating_check;
alter table public.orders add constraint orders_review_rating_check
  check (review_rating is null or (review_rating between 1 and 5));

alter table public.chat_sessions
  add column if not exists pending_review_order_id uuid references public.orders(id) on delete set null;

create index if not exists chat_sessions_pending_review_idx
  on public.chat_sessions (pending_review_order_id)
  where pending_review_order_id is not null;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'new_order','handoff','alert_signal','channel_request','payment_proof',
    'upgrade_request','review','order_updated'
  ));
