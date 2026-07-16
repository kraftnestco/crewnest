-- Stage N (docs/12 §2.2, §5.5) — pgvector retrieval. N1 [OPUS] decision frozen 2026-07-16.
create extension if not exists vector;

create table public.knowledge_chunks (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  source      text not null,          -- 'catalogue' | 'knowledge' | 'file'
  source_ref  text,                   -- section / file name, for re-embed + display
  content     text not null,          -- the chunk text, fed to the model verbatim on retrieval
  embedding   vector(1536),           -- text-embedding-3-small (§5.5.2)
  token_count int,
  created_at  timestamptz not null default now()
);

create index knowledge_chunks_tenant_idx on public.knowledge_chunks (tenant_id);
-- hnsw / cosine, defaults m=16 ef_construction=64 (§5.5.3).
create index knowledge_chunks_embedding_idx on public.knowledge_chunks
  using hnsw (embedding vector_cosine_ops);

alter table public.knowledge_chunks enable row level security;
create policy knowledge_chunks_select on public.knowledge_chunks
  for select to authenticated using (public.user_can_access_tenant(tenant_id));
-- INSERT/UPDATE/DELETE via service role only (the ingestion job) — matches usage_logs / orders.

-- Retrieval RPC — service-role-only, tenant filter baked in (server-bound identity, §5.5.4).
create or replace function public.match_knowledge_chunks(p_tenant uuid, p_query vector(1536), p_k int)
returns table (id uuid, source text, source_ref text, content text, distance float4)
language sql stable security definer set search_path = '' as $$
  select kc.id, kc.source, kc.source_ref, kc.content, (kc.embedding operator(public.<=>) p_query) as distance
  from public.knowledge_chunks kc
  where kc.tenant_id = p_tenant
  order by kc.embedding operator(public.<=>) p_query
  limit p_k;
$$;
revoke all on function public.match_knowledge_chunks(uuid, vector, int) from public, anon, authenticated;
grant execute on function public.match_knowledge_chunks(uuid, vector, int) to service_role;
