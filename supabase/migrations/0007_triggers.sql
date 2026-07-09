-- 0007_triggers.sql
-- Automation: profile auto-creation, updated_at maintenance, session bump.

-- Create a profiles row when a new auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', null)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Maintain tenants.updated_at.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tenants_set_updated_at on public.tenants;
create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function public.set_updated_at();

-- Bump session activity on each new message; count inbound (user) as unread.
create or replace function public.bump_session_on_message()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.chat_sessions
     set last_message_at = now(),
         unread_count = unread_count + (case when new.role = 'user' then 1 else 0 end)
   where id = new.session_id;
  return new;
end;
$$;

drop trigger if exists chat_messages_bump_session on public.chat_messages;
create trigger chat_messages_bump_session
  after insert on public.chat_messages
  for each row execute function public.bump_session_on_message();
