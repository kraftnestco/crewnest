-- 0037_push_subscriptions.sql
-- docs/21-WEB-PUSH-NOTIFICATIONS.md §3. Web Push subscriptions — one row per
-- (user, browser endpoint), so a person with a phone and a laptop has two.
-- Additive + idempotent, same convention as every other migration here.

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  -- Globally unique by construction (it IS the push service's per-browser URL),
  -- so this doubles as the natural upsert key when a browser re-subscribes.
  endpoint    text not null unique,
  -- The browser's own encryption keys. NOT secrets of ours: they are handed to
  -- us by the browser precisely so we can encrypt payloads TO it. The VAPID
  -- PRIVATE key (the thing that must never leak) lives in env, never here.
  p256dh      text not null,
  auth        text not null,
  -- Purely so a user can tell "which device is this?" in a future device list.
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Owner-scoped: a user sees and revokes only their own devices. Deliberately NO
-- insert policy — subscriptions are written by a server action through the
-- service client, which binds user_id from the verified session rather than
-- trusting client input (same posture as services/teamMembers.ts). Sends also
-- run service-role, bypassing RLS by design.
drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions
  for delete to authenticated
  using (user_id = auth.uid());
