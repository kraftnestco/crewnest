-- 0020_catalog_freeform_text.sql
-- Client "My Business" catalogue editing is being switched from a raw-JSON
-- textarea to plain-language free text (docs/13 §9 follow-up — clients are
-- non-technical). This column holds the client's own words; catalog_data
-- stays the derived structured JSON the AI actually reads (unchanged
-- consumer contract in promptBuilder/knowledge.ts). Admin still edits
-- catalog_data directly; this is reference-only on the admin side.
--
-- Row-level, not column-level (see 0018) — already covered by
-- tenants_update_self, no RLS change needed.

alter table public.tenants
  add column if not exists catalog_freeform_text text;
