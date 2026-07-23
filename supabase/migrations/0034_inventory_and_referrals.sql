-- 0034_inventory_and_referrals.sql
-- docs/19 I1 (Inventory Lite) + G1 (Growth mechanics). Additive only.
--
-- PARKED: apply by hand, then regenerate src/types/database.ts. Until then the
-- app degrades gracefully — the low-stock notification insert and the referral
-- attribution write are both best-effort and simply no-op on the not-yet-widened
-- constraint / not-yet-present column (see inventoryStore.ts and
-- signup/provision-actions.ts). Nothing else depends on this migration.

-- ---------------------------------------------------------------------------
-- I1 — low-stock / out-of-stock alerts are a new notification type. Redefine the
-- constraint with the FULL current list so this file is correct standing on its
-- own, whatever order it runs relative to the (also-parked) 0029. Mirrors the
-- exact list migration 0031 installed, plus 'low_stock'.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'new_order','handoff','alert_signal','channel_request','payment_proof',
    'upgrade_request','review','order_updated','media_review','system_alert',
    'low_stock'
  ));

-- ---------------------------------------------------------------------------
-- G1 — referral attribution. Records which existing tenant's widget badge (or
-- shared `?ref=` link) a self-serve signup came through. Nullable, free-text
-- slug/id; app-sanitised on the way in (RefCapture). No FK: the referrer is
-- identified by slug OR id and may not resolve to a live row, so we keep it a
-- plain string for analytics rather than a constrained relation. Referral
-- *credits* / rewards are deferred — this is capture-only.
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column if not exists referred_by text;
