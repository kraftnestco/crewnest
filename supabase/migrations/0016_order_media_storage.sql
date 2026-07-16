-- 0016_order_media_storage.sql
-- Stage E4 [OPUS]: the private `order-media` Storage bucket + its storage.objects
-- RLS grants (deferred out of 0011 as the security-critical, Opus-gated step —
-- docs/10-CUSTOM-ORDERS-MEDIA-AND-INTAKE.md §2.4, §7.2, §11).
--
-- Threat model this closes: customer-sent media (phone-case screenshots, voice
-- notes, video) is downloaded SERVER-SIDE with the tenant's channel token and
-- persisted here. It must be readable by the owning tenant's staff (and platform
-- admins) but NEVER by another tenant, and never publicly. Object keys are
-- `<tenant_id>/<session_id>/<uuid>.<ext>`, so the first path segment IS the
-- tenant boundary.
--
-- Numbering note: 0013 (payments, doc 11 Stage J) and 0015 (knowledge_chunks,
-- doc 12 Stage N) are RESERVED-but-unbuilt; the gap is intentional. This lands
-- as 0016 to avoid colliding with either reservation.
--
-- Privilege note: verified on this project that the `postgres` migration role can
-- `insert into storage.buckets` and `create policy on storage.objects` even
-- though `supabase_storage_admin` owns those objects (Supabase grants postgres
-- the privilege; SET ROLE is NOT available and NOT needed). RLS is already
-- enabled on storage.objects, so we do not (and cannot, as non-owner) toggle it.

-- 1. Private, tenant-scoped bucket. `public=false` ⇒ no anonymous/CDN read path;
--    the app hands out short-TTL signed URLs (minted server-side) only.
insert into storage.buckets (id, name, public)
  values ('order-media', 'order-media', false)
  on conflict (id) do nothing;

-- 2. SELECT: a signed-in user may read an object only when they can access the
--    tenant that owns it. `public.user_can_access_tenant` already returns true
--    for platform admins (agency dashboard) and for members of the tenant
--    (Phase-2 client dashboard) — same helper every table policy uses (0006).
--
--    The `bucket_id = 'order-media'` guard is load-bearing: without it this
--    permissive policy would also grant read on any FUTURE bucket whose first
--    folder happens to be an accessible tenant id.
--
--    The `::uuid` cast is safe because only the service role writes here, always
--    with a `<tenant_uuid>/...` key; a malformed key would fail closed (error),
--    never leak. Today this policy is defense-in-depth — the app reads via the
--    service role + signed URLs (RLS-bypassing) — but it guarantees any future
--    authenticated direct read is tenant-isolated by construction.
drop policy if exists order_media_select on storage.objects;
create policy order_media_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'order-media'
    and public.user_can_access_tenant(((storage.foldername(name))[1])::uuid)
  );

-- 3. No INSERT/UPDATE/DELETE policy for authenticated (or anon) is defined ⇒ RLS
--    denies all writes to this bucket for client roles. Uploads, overwrites and
--    cleanup happen ONLY through the service role (services/meta/media.ts,
--    server-only), which bypasses RLS by design — identical posture to
--    usage_logs / webhook_events (read-only for members, writes service-role
--    only). A tenant member therefore cannot upload arbitrary objects, overwrite
--    another object, or delete media.
