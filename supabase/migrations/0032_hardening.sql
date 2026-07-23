-- 0032_hardening.sql
-- Stage U (docs/18-HARDENING-AND-TEAM.md §6). Additive only.
--
-- This file grows across Stage U's sub-stages: U-mem below, then U-cap's
-- tenants.free_monthly_cap_usd appended in the same file per doc-18 §6's single-
-- migration bundling — not applied yet (hand-run by the user via the Supabase SQL
-- editor once the whole of Stage U lands), so appending here rather than splitting
-- into a second migration is safe.

-- ---------------------------------------------------------------------------
-- U-mem (§2) — rolling conversation summary. Null summary = never refreshed yet
-- (a short conversation that never truncates its window stays null forever, by
-- design — see MEMORY_TOKEN_BUDGET gating in aiOrchestrator.ts).
-- ---------------------------------------------------------------------------
alter table public.chat_sessions
  add column if not exists summary text;

alter table public.chat_sessions
  add column if not exists summary_through_message_at timestamptz;

-- ---------------------------------------------------------------------------
-- U-cap (§3) — free-plan monthly master-key cost ceiling. Null = use the
-- platform default (DEFAULT_FREE_MONTHLY_CAP_USD in lib/constants.ts), not
-- "uncapped" — every free-plan tenant is bounded; set a value here to override
-- it per tenant. Applies only to plan='free' AND non-BYOK turns.
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column if not exists free_monthly_cap_usd numeric;
