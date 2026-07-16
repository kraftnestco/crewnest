-- 0014_knowledge.sql
-- Small, structured, stuffable business knowledge (FAQ/policies/delivery) +
-- business hours. Additive, all nullable ⇒ no behaviour change for existing
-- tenants. See docs/12-KNOWLEDGE-BASE-AND-RETRIEVAL.md §2.1.

alter table public.tenants
  add column if not exists knowledge_base jsonb, -- structured FAQ/policies; folded into ## KNOWLEDGE
  add column if not exists business_hours jsonb, -- { week:[{ day, open, close }...], note? }
  add column if not exists timezone       text;  -- IANA tz (e.g. 'Asia/Karachi') for the open-now verdict
