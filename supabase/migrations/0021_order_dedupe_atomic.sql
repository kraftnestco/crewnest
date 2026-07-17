-- 0021_order_dedupe_atomic.sql
-- Fixes a TOCTOU race in create_order: the previous flow ran the duplicate
-- check (orders.recentDuplicate) and the insert (orders.create) as two
-- separate Supabase calls, each its own implicit transaction. Two
-- near-simultaneous create_order tool calls for the same session (e.g. a
-- customer double-sending their confirmation) could both pass the check
-- before either insert committed, producing duplicate orders + duplicate
-- owner WhatsApp pushes. This collapses check+insert into one atomic RPC,
-- serialized per session_id via an advisory lock — see docs/09 §3.2 for the
-- existing service-role-only write posture this preserves.

alter table public.orders
  add column if not exists dedupe_fingerprint text;

-- Speeds up the atomic function's per-session duplicate lookup below.
create index if not exists orders_session_fingerprint_idx
  on public.orders (session_id, dedupe_fingerprint, created_at desc);

-- The fingerprint is still computed in TS (orders.computeFingerprint) — this
-- just checks it against a stored column instead of duplicating the item/
-- customer/attachment normalisation logic in SQL.
create or replace function public.create_order_atomic(
  p_tenant_id uuid,
  p_session_id uuid,
  p_platform public.platform,
  p_external_user_id text,
  p_items jsonb,
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text,
  p_notes text,
  p_status public.order_status,
  p_attachments jsonb,
  p_payment_method text,
  p_amount_total numeric,
  p_currency text,
  p_fingerprint text,
  p_dedupe_window_minutes int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  -- Serializes concurrent create_order calls for the same session so the
  -- check-then-insert below can't race across two separate calls. The _xact_
  -- variant auto-releases on commit/rollback, so a crash mid-function can't
  -- leak the lock.
  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));

  if exists (
    select 1 from public.orders
    where session_id = p_session_id
      and dedupe_fingerprint = p_fingerprint
      and created_at >= now() - make_interval(mins => p_dedupe_window_minutes)
  ) then
    return jsonb_build_object('is_duplicate', true);
  end if;

  insert into public.orders (
    tenant_id, session_id, platform, external_user_id, items, customer_name,
    customer_phone, customer_address, notes, status, attachments,
    payment_method, amount_total, currency, dedupe_fingerprint
  ) values (
    p_tenant_id, p_session_id, p_platform, p_external_user_id, p_items, p_customer_name,
    p_customer_phone, p_customer_address, p_notes, p_status, p_attachments,
    p_payment_method, p_amount_total, p_currency, p_fingerprint
  )
  returning * into v_order;

  return to_jsonb(v_order) || jsonb_build_object('is_duplicate', false);
end;
$$;

-- Same access-control shape as the Vault helpers (migration 0005): this does
-- a raw insert bypassing orders' RLS (which has no authenticated INSERT
-- policy at all, matching usage_logs — migration 0009's comment), so it must
-- never be reachable by anon/authenticated, only the service-role client
-- (src/lib/supabase/service.ts).
revoke all on function public.create_order_atomic(
  uuid, uuid, public.platform, text, jsonb, text, text, text, text,
  public.order_status, jsonb, text, numeric, text, text, int
) from public, anon, authenticated;
grant execute on function public.create_order_atomic(
  uuid, uuid, public.platform, text, jsonb, text, text, text, text,
  public.order_status, jsonb, text, numeric, text, text, int
) to service_role;
