-- 0039_message_batching.sql
-- docs/23-MESSAGE-BATCHING.md §3, §5.4. Additive only.
--
-- Lets one AI turn answer a whole burst of customer messages instead of firing a
-- separate turn per message. Two mechanisms need state:
--   (a) a per-session turn LOCK, so two workers can't both run a turn; and
--   (b) a per-session monotonic COUNTER, so a worker mid-LLM-call can cheaply
--       detect "a newer message arrived" and restart with everything combined
--       (§5.1) — no LISTEN/NOTIFY, no Redis, just a column poll.

alter table public.chat_sessions
  -- Non-null AND in the future ⇒ some worker owns this session's turn. Expires
  -- so a crashed worker can't deadlock the session forever (§3.1).
  add column if not exists turn_lease_until timestamptz,
  -- Who owns the lease. Release/renew are gated on this so a worker whose lease
  -- already expired (and was taken by someone else) is a no-op, never a clobber.
  add column if not exists turn_lease_id    uuid,
  -- Bumped on EVERY persisted inbound customer message. The supersession signal.
  add column if not exists inbound_epoch    bigint not null default 0;

-- §5.4 — metering an aborted call. A call we hung up on has no provider `usage`
-- object: its prompt tokens are still exactly knowable (we built the prompt), but
-- its completion tokens are genuinely unknown. Recording that unknown as 0 would
-- be a quiet lie, so the column becomes nullable and `superseded` marks the row.
-- Calls that RETURN are unaffected and still carry the provider's real numbers.
alter table public.usage_logs
  alter column completion_tokens drop not null;

alter table public.usage_logs
  add column if not exists superseded boolean not null default false;

-- Claim the turn for a session. MUST be a single statement: a read-then-write
-- races two workers into the same session. Returns true exactly once per free
-- lease; a losing caller gets no row back (⇒ false in the client).
create or replace function public.claim_session_turn(
  p_session_id uuid,
  p_lease_id   uuid,
  p_ttl_seconds int
)
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.chat_sessions
     set turn_lease_until = now() + make_interval(secs => p_ttl_seconds),
         turn_lease_id    = p_lease_id
   where id = p_session_id
     and (turn_lease_until is null or turn_lease_until < now())
  returning true;
$$;

-- Extend a lease we still own — called on each supersession restart so a long
-- burst can't let the lease expire underneath its owner (§5.2).
create or replace function public.renew_session_turn(
  p_session_id uuid,
  p_lease_id   uuid,
  p_ttl_seconds int
)
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.chat_sessions
     set turn_lease_until = now() + make_interval(secs => p_ttl_seconds)
   where id = p_session_id
     and turn_lease_id = p_lease_id
  returning true;
$$;

-- Release a lease we still own. The turn_lease_id guard is the point: a worker
-- that overran its TTL must not release the lease a DIFFERENT worker now holds.
create or replace function public.release_session_turn(
  p_session_id uuid,
  p_lease_id   uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.chat_sessions
     set turn_lease_until = null,
         turn_lease_id    = null
   where id = p_session_id
     and turn_lease_id = p_lease_id
  returning true;
$$;

-- Persist-and-bump in one statement (§4 phase 1 step 4). The epoch bump must not
-- be a second round trip: a message that is persisted but whose epoch never moved
-- is invisible to the supersession check, i.e. silently unanswered.
create or replace function public.bump_inbound_epoch(p_session_id uuid)
returns bigint
language sql
security definer
set search_path = public
as $$
  update public.chat_sessions
     set inbound_epoch = inbound_epoch + 1
   where id = p_session_id
  returning inbound_epoch;
$$;

-- Service-role only, same posture as the rest of the turn pipeline: these are
-- called from the orchestrator (service client), never from an authenticated
-- browser session. SECURITY DEFINER above + no grant to anon/authenticated.
revoke all on function public.claim_session_turn(uuid, uuid, int)   from public, anon, authenticated;
revoke all on function public.renew_session_turn(uuid, uuid, int)   from public, anon, authenticated;
revoke all on function public.release_session_turn(uuid, uuid)      from public, anon, authenticated;
revoke all on function public.bump_inbound_epoch(uuid)              from public, anon, authenticated;
