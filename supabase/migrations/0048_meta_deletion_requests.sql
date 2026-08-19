-- 0048_meta_deletion_requests.sql
-- Meta App Review requires a data-deletion callback that returns a status URL
-- and confirmation code. Shop owners almost never open this; Meta's reviewer does.
-- Writes are service-role only (no authenticated policies). The public status page
-- looks up by unguessable confirmation_code via the service client.

create table if not exists public.meta_deletion_requests (
  confirmation_code  text primary key,
  facebook_user_id   text not null,
  status             text not null default 'received'
                     check (status in ('received', 'completed')),
  created_at         timestamptz not null default now(),
  completed_at       timestamptz
);

create index if not exists meta_deletion_requests_fb_user_idx
  on public.meta_deletion_requests (facebook_user_id);

alter table public.meta_deletion_requests enable row level security;
