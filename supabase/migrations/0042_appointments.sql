-- 0042_appointments.sql
-- Appointment booking for service businesses. See docs/24-APPOINTMENTS.md.
--
-- ClerkNest owns scheduling; Cal.com (when used) only mints a meeting link for a
-- booking that has already been decided here — docs/24 §1.1 explains why, in
-- short: one ClerkNest-owned Cal.com account means shared availability, so
-- letting Cal.com own slots would make two tenants collide on the same hour.
--
-- Additive only. Safe to re-run.

-- ---------------------------------------------------------------------------
-- Tenant-level booking configuration (docs/24 §2.2)
-- ---------------------------------------------------------------------------
alter table public.tenants
  -- Gates the booking tools. Separate from business_type so a service tenant
  -- can decline booking without changing what it calls its jobs.
  add column if not exists booking_enabled          boolean not null default false,
  -- 'own_link' = the business pastes its own Zoom/Meet room or address.
  -- 'calcom'   = mint a fresh Google Meet URL per booking.
  add column if not exists booking_mode             text,
  add column if not exists booking_own_link         text,
  add column if not exists booking_duration_minutes integer not null default 30,
  -- Minimum notice, so the AI can't offer a slot five minutes from now.
  add column if not exists booking_lead_time_minutes integer not null default 120,
  add column if not exists booking_max_days_ahead   integer not null default 30;

alter table public.tenants drop constraint if exists tenants_booking_mode_check;
alter table public.tenants add constraint tenants_booking_mode_check
  check (booking_mode is null or booking_mode in ('own_link', 'calcom'));

-- Per-tenant sequential appointment numbers, exactly mirroring orders'
-- next_order_number (migration 0040). Customers must never be shown a uuid.
alter table public.tenants
  add column if not exists next_appointment_number integer not null default 1;

-- ---------------------------------------------------------------------------
-- appointments (docs/24 §2.1)
-- ---------------------------------------------------------------------------
create table if not exists public.appointments (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  -- Matches orders: keep the appointment if the conversation is erased.
  session_id         uuid references public.chat_sessions(id) on delete set null,
  appointment_number integer,
  -- The instant, always UTC here; rendered in the tenant's tz at the edges.
  -- Never store wall-clock text (docs/24 §3, DST note).
  starts_at          timestamptz not null,
  -- Snapshotted at booking time so changing tenant config later can't silently
  -- re-length appointments that were already agreed with a customer.
  duration_minutes   integer not null,
  status             text not null default 'booked',
  customer_name      text,
  customer_phone     text,
  notes              text,
  service_name       text,
  -- Path A: the tenant's fixed link. Path B: the per-booking Meet URL.
  -- Nullable on purpose: a Cal.com outage must not fail a booking the customer
  -- has already been promised (docs/24 §4.3) — the row stays booked, link blank.
  meeting_url        text,
  location_text      text,
  calcom_booking_uid text,
  platform           platform,
  external_user_id   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.appointments drop constraint if exists appointments_status_check;
alter table public.appointments add constraint appointments_status_check
  check (status in ('booked', 'cancelled', 'completed', 'no_show'));

-- Conflict check + both dashboard lists read this.
create index if not exists appointments_tenant_starts_idx
  on public.appointments (tenant_id, starts_at desc);

create unique index if not exists appointments_tenant_number_idx
  on public.appointments (tenant_id, appointment_number);

-- THE double-booking guard (docs/24 §2.1, §4.2). Partial, so cancelled rows
-- free their slot for rebooking. A read-then-write availability check loses
-- races; this cannot — a concurrent booking of the same slot fails with 23505,
-- which the tool catches and turns into "that time was just taken".
create unique index if not exists appointments_no_double_booking_idx
  on public.appointments (tenant_id, starts_at)
  where status = 'booked';

drop trigger if exists appointments_set_updated_at on public.appointments;
create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

-- Same posture as orders (migration 0009): authenticated users may READ their
-- own tenant's rows; every write goes through the service-role client.
alter table public.appointments enable row level security;

drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments
  for select to authenticated using (public.user_can_access_tenant(tenant_id));

-- ---------------------------------------------------------------------------
-- Atomic booking (docs/24 §4.2)
-- ---------------------------------------------------------------------------
-- Claims the next per-tenant number AND inserts in ONE statement-level
-- transaction, so a crash can't burn a number without a row. The UPDATE ...
-- RETURNING on tenants row-locks that tenant, serialising concurrent claims —
-- the same mechanism as claim_next_order_number (migration 0040).
--
-- Returns the inserted row as jsonb, or null when the slot was taken. The
-- caller distinguishes those cases; a null is NOT an error, it's "offer
-- alternatives".
create or replace function public.book_appointment_atomic(
  p_tenant_id        uuid,
  p_session_id       uuid,
  p_starts_at        timestamptz,
  p_duration_minutes integer,
  p_customer_name    text,
  p_customer_phone   text,
  p_service_name     text,
  p_notes            text,
  p_platform         public.platform,
  p_external_user_id text,
  p_meeting_url      text,
  p_location_text    text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number integer;
  v_row    public.appointments;
begin
  update public.tenants
     set next_appointment_number = next_appointment_number + 1
   where id = p_tenant_id
  returning next_appointment_number - 1 into v_number;

  if v_number is null then
    return null; -- unknown tenant
  end if;

  begin
    insert into public.appointments (
      tenant_id, session_id, appointment_number, starts_at, duration_minutes,
      customer_name, customer_phone, service_name, notes, platform,
      external_user_id, meeting_url, location_text
    ) values (
      p_tenant_id, p_session_id, v_number, p_starts_at, p_duration_minutes,
      p_customer_name, p_customer_phone, p_service_name, p_notes, p_platform,
      p_external_user_id, p_meeting_url, p_location_text
    )
    returning * into v_row;
  exception when unique_violation then
    -- Lost the race for this slot. Return null rather than raising: the caller
    -- turns this into "that time just went, here are the next options".
    return null;
  end;

  return to_jsonb(v_row);
end;
$$;

-- Service-role only, same as create_order_atomic (migration 0021): this inserts
-- bypassing RLS, so it must never be reachable by anon/authenticated.
revoke all on function public.book_appointment_atomic(
  uuid, uuid, timestamptz, integer, text, text, text, text, public.platform, text, text, text
) from public, anon, authenticated;
grant execute on function public.book_appointment_atomic(
  uuid, uuid, timestamptz, integer, text, text, text, text, public.platform, text, text, text
) to service_role;
