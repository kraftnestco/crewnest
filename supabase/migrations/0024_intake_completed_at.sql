-- Marks when a tenant's owner has completed the step-by-step intake wizard at
-- least once (docs: "try it for your business" plan, Phase A). Null = the
-- dashboard shows the wizard; set = the dashboard shows a summary + Edit button.
alter table public.tenants
  add column if not exists intake_completed_at timestamptz;
