# 12 — Knowledge Base, FAQ & Retrieval (Phase 2 → Phase 3)

This is the design for everything a customer asks that is **not** in the product catalogue: *"what's your
return policy?"*, *"do you deliver to Hyderabad?"*, *"are you open right now?"*, *"is this halal?"*, *"how
long is the warranty?"*, *"where are you located?"*. Today the AI can only answer from `system_prompt` +
`catalog_data`; anything else forces a guess or a `[HUMAN_HANDOFF]`. This document gives the assistant a
real **knowledge base**.

It is deliberately **two-tier**, because "knowledge beyond catalogue" is really two different problems:

- **Small, structured business knowledge** (policies, FAQs, hours, delivery zones) — this **fits in the
  token budget** and belongs in the **cached prefix**, exactly like the catalogue. **Zero new
  infrastructure.** This is **Stage M**, and it covers the overwhelming majority of what an SMB customer
  asks.
- **Large corpora that outgrow the budget** (long policy documents, big FAQ libraries, product manuals,
  uploaded files) — this genuinely needs **`pgvector` retrieval**. This is **Stage N**, the Phase-3
  `[OPUS]` "RAG retrieval design" checkpoint ([`07-PHASES.md`](./07-PHASES.md)), and it honours locked
  decision #6 ("stuff-and-cache first; pgvector retrieval only when a catalogue outgrows the budget") and
  #1 ("pgvector, **no Pinecone** — one datastore").

**Designed in an Opus session (2026-07-16).** Stage M is **additive and backward-compatible** (a tenant
with no knowledge base behaves exactly as today) and **mechanical for Sonnet**. Stage N is an `[OPUS]`
design that this document scopes and gates; its retrieval internals are finalised in the Opus pass that
builds it.

---

## 1. Scope, staging & locked decisions

| Stage | What | Depends on | Model |
|-------|------|-----------|-------|
| **M** | **Structured knowledge base** (FAQ / policies / delivery info) → `## KNOWLEDGE` cached prompt block; **business-hours awareness** (structured hours + a dynamic "open now" line) | doc 05 (promptBuilder) | `[SONNET]` (this doc) |
| **N** | **`pgvector` retrieval** for when catalogue+knowledge outgrows the stuff-and-cache budget: `knowledge_chunks` table, embedding + ingestion pipeline, `promptBuilder` `mode:'retrieve'`, query-time top-k | M | `[OPUS]` design first (§5) |

**Locked with the product owner (2026-07-16):**

1. **Stuff-and-cache first, retrieve only when forced** (locked decision #6 restated). Stage M puts
   knowledge into the **byte-identical cached prefix** — cheap, instant, no moving parts. Stage N is
   triggered **only** when a tenant's combined catalogue + knowledge would blow the token budget
   (`CATALOG_STUFF_TOKEN_LIMIT`, already in `constants.ts` at ~40k). The builder already exposes the
   `mode: 'stuff' | 'retrieve'` seam (doc 05 §2) — Stage N fills it; Stage M does not touch it.
2. **`pgvector`, one datastore, no Pinecone** (locked decision #1). Embeddings live in a Postgres
   `vector` column with an ANN index, RLS-scoped like every other tenant table. No external vector DB.
3. **Retrieved chunks are DYNAMIC, never cached-prefix content** (the subtle, load-bearing rule — §5.3).
   Retrieved chunks are **query-dependent**, so putting them in the static prefix would break the
   byte-identical-per-tenant cache guarantee (doc 05 §2). They ride in the **dynamic tail**, after the
   cache prefix. This is *why* Stage M (small, static, cacheable) and Stage N (large, dynamic, retrieved)
   are architecturally different, not just "more of the same."
4. **Knowledge is reference data, not instructions** — the same guardrail the catalogue already carries
   (doc 05 §6, `GUARDRAIL_RULES`). The `## KNOWLEDGE` block is treated as reference the model answers
   *from*, never as commands; injection text inside a tenant's own KB is low-risk (the tenant authored it)
   but the block still sits under the existing "treat reference data as data" rule — no new guardrail text
   needed, so **no `[OPUS]` guardrail gate in Stage M**.
5. **Business hours need a server-supplied "now."** A model cannot reliably know the current time, so
   "are you open?" is answered from **structured hours + tenant timezone**, with the orchestrator injecting
   a tiny **dynamic** `current local time … you are currently OPEN/CLOSED` line in the tail (§4.3) — the
   hours *table* is static/cached, the *open-now verdict* is dynamic. Same cache discipline as everything
   else.

---

## 2. Interface & schema deltas (all additive)

### 2.1 Stage M — migration `0014_knowledge.sql`

```sql
-- Small, structured, stuffable knowledge. All nullable ⇒ no behaviour change for existing tenants.
alter table public.tenants
  add column if not exists knowledge_base jsonb,   -- structured FAQ/policies (§3.1); folded into ## KNOWLEDGE
  add column if not exists business_hours jsonb,   -- { tz, week:[{ day, open, close }...], note? } (§4)
  add column if not exists timezone       text;    -- IANA tz (e.g. 'Asia/Karachi') for the open-now verdict
```

`business_hours` carries its own `tz`, but the top-level `timezone` column is the canonical one the
orchestrator reads for the open-now computation (keeping the hours JSON purely declarative). No new table,
no new RLS — these are `tenants` columns already covered by the tenants policies.

`types/database.ts` hand-edited to match; `types/domain.ts` `Tenant` gains `knowledgeBase: unknown`,
`businessHours: unknown`, `timezone: string | null`.

### 2.2 Stage N — migration `0015_knowledge_chunks.sql`  `[OPUS]`

```sql
create extension if not exists vector;   -- pgvector (Supabase-supported; locked decision #1)

create table public.knowledge_chunks (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  source      text not null,          -- 'catalogue' | 'knowledge' | 'file'
  source_ref  text,                   -- section / file name, for re-embed + display
  content     text not null,          -- the chunk text, fed to the model verbatim on retrieval
  embedding   vector(1536),           -- text-embedding-3-small (the [OPUS] model choice, §5.2)
  token_count int,
  created_at  timestamptz not null default now()
);

create index knowledge_chunks_tenant_idx on public.knowledge_chunks (tenant_id);
-- ANN index — [OPUS] picks hnsw-vs-ivfflat + params in the Stage-N pass (§5.2)
create index knowledge_chunks_embedding_idx on public.knowledge_chunks
  using hnsw (embedding vector_cosine_ops);

alter table public.knowledge_chunks enable row level security;
create policy knowledge_chunks_select on public.knowledge_chunks
  for select to authenticated using (public.user_can_access_tenant(tenant_id));
-- INSERT/UPDATE/DELETE via service role only (the ingestion job) — matches usage_logs / orders.
```

Retrieval itself uses a `SECURITY DEFINER` RPC (`match_knowledge_chunks(tenant, query_embedding, k)`) or a
service-role query in the ingestion/orchestrator path — the exact call site is a Stage-N `[OPUS]` decision
(§5.2). **The ANN index + any new SQL function grants are the security-critical part of Stage N and are
its `[OPUS]` gate** (mirrors the doc-07 Phase-1 RLS/Vault `[OPUS]` rule and doc-10 E4).

---

## 3. Stage M — the structured knowledge base

Ships immediately, no external calls, and covers the bulk of real SMB questions.

### 3.1 Shape of `knowledge_base`

A small structured JSON the intake wizard writes — **entries**, each a topic + answer, plus a couple of
first-class policy fields the model is told to always honour:

```jsonc
{
  "faq": [
    { "q": "Do you deliver nationwide?", "a": "Yes, across Pakistan; Karachi/Lahore/Islamabad in 2–3 days, elsewhere 4–6." },
    { "q": "What's your return policy?",  "a": "Exchange within 7 days with the receipt; no returns on custom items." }
  ],
  "delivery": "Delivery charge PKR 200; free over PKR 5000. COD available nationwide.",
  "returns":  "7-day exchange with receipt; custom orders are non-returnable.",
  "location": "Shop 12, Tariq Road, Karachi.",
  "note":     "Free-form anything-else the client wants the AI to know."
}
```

All fields optional; the wizard renders friendly inputs (an FAQ repeater + a few policy textareas). It is
the **tenant's own words**, folded verbatim into the prompt — the same philosophy as
`custom_order_instructions` (doc 10 §3.1).

### 3.2 `## KNOWLEDGE` prompt block (deterministic, cache-safe)

A new static per-tenant block, placed **after `## CATALOGUE`/`## RULES`** and gated on a non-empty
`knowledge_base`, composed from stably-ordered parts so the prefix stays byte-identical per tenant config
(doc 05 §2). `promptBuilder.buildKnowledgeBlock(tenant)` mirrors the existing block builders exactly:

```
## KNOWLEDGE (reference data)
Answer business questions (delivery, returns, location, policies, general FAQ) using ONLY the
information below. If something isn't covered here or in the CATALOGUE, say you'll check with the
team rather than guessing — or use [HUMAN_HANDOFF] for anything sensitive.
Delivery: <delivery>
Returns:  <returns>
Location: <location>
FAQ:
- Q: <q>  A: <a>
- …
<note verbatim>
```

Deterministic serialisation (stable key order, sorted FAQ) so byte layout is stable — reuse the
`stableStringify` discipline already in `promptBuilder`. This block is **reference data under the existing
guardrail** (§1.4) — no new guardrail wording, so Stage M has **no `[OPUS]` gate**.

### 3.3 The catalogue-vs-knowledge boundary

`## CATALOGUE` stays *products/prices*; `## KNOWLEDGE` is *everything else about the business*. Keeping
them separate blocks (not merged) means Stage N can later move **either one** to retrieval independently
(a tenant with a huge catalogue but tiny FAQ retrieves the catalogue and still stuffs the FAQ, and vice
versa — §5.1).

### 3.4 Budget guard (the Stage-M → Stage-N tripwire)

`buildSystemPrefix` already has the catalogue token guard (`CATALOG_STUFF_TOKEN_LIMIT`, doc 05 §2). Extend
it to sum **catalogue + knowledge** tokens; if the total would exceed the limit, the builder is in
`mode:'retrieve'` territory (Stage N). Until Stage N exists, Stage M simply **logs a warning** and stuffs
anyway (correct for every small tenant; the warning tells us when a tenant has outgrown stuffing). This is
the honest seam: Stage M is complete and useful on its own; Stage N is the upgrade for the tenant who trips
this guard.

---

## 4. Business-hours awareness (folded into Stage M)

The user flagged "are you open now?" as essential; it lives naturally here because hours are just
structured knowledge — but with one twist (§1.5): the model needs a **server-supplied current time**.

### 4.1 Storage

`business_hours` (§2.1) is a per-day open/close table; `timezone` is the IANA zone. The intake wizard adds
an **Hours** card: a 7-row day/open/close grid + an optional note ("closed on public holidays"), writing
both columns.

### 4.2 The static part — an hours table in `## KNOWLEDGE`

`buildKnowledgeBlock` renders the weekly hours as static text in the cached block ("Mon–Sat 11:00–21:00,
Sun closed") — so "what are your hours?" is answered from cache with zero dynamic input.

### 4.3 The dynamic part — the open-now verdict (in the tail, not the prefix)

The orchestrator computes, **server-side**, the tenant-local current time and whether the business is open
right now, and injects a **single dynamic line** as a `system`-role message **placed after the cache prefix
and before the user turn** (never inside the prefix — that would break caching, §1.3):

```
[context] Current local time for this business: Saturday 14:32 (Asia/Karachi). The business is currently OPEN.
```

The model uses it to answer "are you open?" / "can I come now?" accurately. Computed with the tenant
timezone from a small `services/hours.ts` helper (pure function: `(businessHours, timezone, now) →
{ isOpen, localTimeLabel }`), unit-testable, no external calls. Only emitted when `business_hours` is set.

> **Why the tail, not the prefix:** this is the same rule that governs Stage N retrieval (§5.3). Anything
> that varies turn-to-turn (the clock, retrieved chunks) is **dynamic** and must sit after the byte-identical
> cache prefix. Getting this wrong silently destroys the prompt cache and inflates every tenant's cost.

---

## 5. Stage N — `pgvector` retrieval  `[OPUS]` design first

Triggered only when a tenant trips the §3.4 budget guard. This is the doc-07 Phase-3 "RAG retrieval design"
`[OPUS]` checkpoint; the design is scoped here and finalised in its build-time Opus pass.

### 5.1 What gets retrieved

Any `source` in `knowledge_chunks`: an over-budget **catalogue**, an over-budget **knowledge base**, or
(a natural extension) **uploaded files** (PDF/CSV price lists, policy docs). Because §3.3 keeps catalogue
and knowledge as separate blocks, a tenant can **stuff one and retrieve the other** — the builder decides
per-source from each source's token size, not globally.

### 5.2 The ingestion pipeline (`services/knowledge.ts` + `services/ai/embed.ts`)

On save of a tenant's catalogue/knowledge/file (a server action, run in `after()` so it never blocks the
save):
1. **Chunk** the source into ~token-bounded pieces (the chunking strategy — size, overlap, structure-aware
   splitting on FAQ/section boundaries — is an `[OPUS]` decision).
2. **Embed** each chunk via `text-embedding-3-small` (the `[OPUS]` model choice; cheap, 1536-dim) with the
   tenant key, metered into `usage_logs` with `model='text-embedding-3-small'` (the doc 05 §7 pattern).
3. **Upsert** into `knowledge_chunks` (service-role), deleting the prior chunks for that `source`/`source_ref`
   first (clean re-embed on change).

### 5.3 Query-time retrieval (the cache-ordering crux)

Per inbound turn, **only in `mode:'retrieve'`**:
1. Embed the **user query** (a billable embedding call, metered).
2. `match_knowledge_chunks(tenant_id, query_embedding, k)` → top-k by cosine (hybrid/keyword fusion and
   re-ranking are `[OPUS]` options, not MVP).
3. Inject the retrieved chunks as a **dynamic** context message **after the cache prefix**, e.g. a
   `system`-role `"## RETRIEVED CONTEXT (reference data)\n<chunks>"` positioned at the head of the dynamic
   tail (before history/user turn). **The cache prefix in retrieve mode does NOT contain the big source**
   (that's the whole point) — it holds only persona + rules + the small always-stuffed blocks, so it stays
   byte-identical and cacheable; the retrieved, query-dependent chunks are dynamic (§1.3).

This realises the `mode: 'stuff' | 'retrieve'` seam doc 05 §2 reserved: `build()` gains a `mode` and, in
retrieve mode, assembles `[cache prefix without the big source] ++ [retrieved chunks] ++ history ++ user`.

### 5.4 The `[OPUS]` gate (N1, §7)

Stage N's design decisions — **chunking strategy, embedding model, ANN index type/params, top-k + token
budget for retrieved context, the exact message-array position of retrieved chunks, and any new SQL
function grants** — are all `[OPUS]` (retrieval quality + cache correctness + a security-sensitive index/RPC).
Once locked, the ingestion/query **plumbing** is mechanical for Sonnet.

### 5.5 N1 decision — FROZEN (Opus, 2026-07-16)

The full retrieval design, locked. Still a design; the Stage-N **build** (migration `0015` + ingestion +
query plumbing) stays Sonnet, triggered when a tenant trips the §3.4 per-source budget.

**1. Chunking — structure-first (not blind fixed windows).**
- **knowledge_base:** one chunk per FAQ entry (`"Q: … A: …"`), one per policy field (delivery / returns /
  location / note). Self-contained ⇒ **no overlap**. `source='knowledge'`, `source_ref =` the field / FAQ key.
- **catalogue:** one chunk per top-level item. `source='catalogue'`, `source_ref =` sku / name.
- **files** (PDF/CSV/policy docs): recursive split on section/paragraph boundaries, **~400-token cap**,
  **~50-token overlap** (prose needs context bleed). `source='file'`, `source_ref =` file + section.
- Hard cap `CHUNK_TOKEN_CAP ≈ 400`; oversize structured entries split on sentence boundaries.

**2. Embedding model — `text-embedding-3-small`** (1536-dim, matches the `0015` `vector(1536)` column;
cheap). Ingest embeds each chunk; query embeds the user turn. Both metered into `usage_logs`
(`model='text-embedding-3-small'`, doc 05 §7). Tenant BYOK key, master fallback — same as chat.

**3. ANN index — `hnsw (embedding vector_cosine_ops)`** (defaults `m=16, ef_construction=64`); cosine
matches normalised text-embedding-3 vectors. Retrieval filters `where tenant_id = $1` (the
`knowledge_chunks_tenant_idx` btree assists; hnsw post-filters) — fine at Phase-3-entry scale. **Scale
note:** move to pgvector ≥ 0.8 **iterative index scans** if per-tenant recall degrades under many tenants;
do **not** prematurely partition or build per-tenant indexes.

**4. Retrieval call site — a `SECURITY DEFINER` RPC, service-role-only (this is N1's security core).** Add
to `0015`:
```sql
create or replace function public.match_knowledge_chunks(p_tenant uuid, p_query vector(1536), p_k int)
returns table (id uuid, source text, source_ref text, content text, distance float4)
language sql stable security definer set search_path = '' as $$
  select kc.id, kc.source, kc.source_ref, kc.content, (kc.embedding <=> p_query) as distance
  from public.knowledge_chunks kc
  where kc.tenant_id = p_tenant          -- tenant filter BAKED IN (server-bound identity, doc 09 §2.5)
  order by kc.embedding <=> p_query
  limit p_k;
$$;
revoke all on function public.match_knowledge_chunks(uuid, vector, int) from public, anon, authenticated;
grant execute on function public.match_knowledge_chunks(uuid, vector, int) to service_role;
```
The orchestrator (unauthenticated `after()` / webhook context, like tenant resolution) calls this via the
**service client**, passing the **server-resolved `tenant.id`** — never model input. The baked-in
`where tenant_id` + **service-role-only EXECUTE grant** (mirroring the `0005` Vault-helper lockdown) is the
security-sensitive part that makes N1 an `[OPUS]` gate — the retrieval analog of E4 for storage. Table RLS
(`knowledge_chunks_select` = `user_can_access_tenant`, service-role writes; §2.2) still guards any future
authenticated direct read (Phase-2 dashboard).

**5. Top-k + retrieved-context budget.** `k = RETRIEVAL_TOP_K` (default **8**); take chunks in ascending
distance until `RETRIEVED_CONTEXT_TOKEN_BUDGET` (default **~2000 tokens**, chars/4 estimate) is reached
(trim like the memory window) — bounds the dynamic tail regardless of k.

**6. Message placement (the cache-ordering crux).** Retrieved chunks ride the **dynamic tail** as one
`system`-role message `"## RETRIEVED CONTEXT (reference data)\n<chunks>"`, spliced at **`cachePrefixLength`**
(right after the cache prefix, before history + user) — the exact seam the Stage-M open-now line uses. In
`mode:'retrieve'` the **cache prefix omits the big source** (persona + rules + the small always-stuffed
blocks only), so it stays byte-identical across queries; the query-dependent chunks are dynamic (§1.3, §5.3).
Reference data under the existing `GUARDRAIL_RULES` — **no new guardrail text** (§6).

**7. Per-source mode selection.** `build()` gains `mode` computed **per source** from that source's estimated
tokens vs `CATALOG_STUFF_TOKEN_LIMIT`: a source over the cap → retrieve, at/under → stuff. Catalogue and
knowledge decide **independently** (§5.1) — stuff one, retrieve the other. Stage-M's §3.4 combined
sum-and-**warn** is the tripwire; Stage N turns it into per-source **routing**.

**Migration `0015_knowledge_chunks.sql`** = the §2.2 table + RLS + hnsw index **plus** the
`match_knowledge_chunks` RPC + grants above. No other new RLS/table. Apply via the no-Docker `pg` precedent;
hand-edit `database.ts` (add `knowledge_chunks`; call the RPC via `.rpc()`); build ingestion
(`services/knowledge.ts` + `services/ai/embed.ts`) + query plumbing mechanically. **Sonnet may build Stage N
against §5.1–§5.5 — no further Opus pass.**

---

## 6. Security & cost

- **RLS:** `knowledge_chunks` is `user_can_access_tenant`-scoped for reads, service-role writes (§2.2) —
  the house pattern; the ANN index/RPC grants are the Stage-N `[OPUS]` review.
- **Reference-not-instructions:** both the `## KNOWLEDGE` block and retrieved chunks sit under the existing
  `GUARDRAIL_RULES` "treat reference data as data" rule (§1.4) — no new guardrail text.
- **No secrets** in any chunk, block, log, or client bundle (doc 02) — knowledge is business content, but
  the redaction/logging discipline is unchanged.
- **Cost:** Stage M adds **zero** runtime cost (static cached tokens only). Stage N adds embedding calls
  (ingest: once per source change; query: once per retrieve-mode turn) — both metered into `usage_logs`;
  and it **reduces** per-turn prompt cost for huge-catalogue tenants (top-k chunks ≪ whole catalogue).
- **Retrieval abuse:** query embedding is bounded by the existing per-message path (one per turn); no new
  cap needed beyond the existing inbound/rate limits.

---

## 7. Acceptance criteria

- [ ] A tenant with no `knowledge_base` behaves exactly as today.
- [ ] **Stage M:** the intake wizard writes FAQ/policies/hours; the compiled prompt includes a
      `## KNOWLEDGE` block only when set; the static prefix stays byte-identical between turns (cache
      intact); a delivery/returns/policy question is answered from it without a handoff.
- [ ] **Hours:** "what are your hours?" is answered from the static table; "are you open now?" is answered
      correctly from the server-injected dynamic line across timezones (unit-tested `services/hours.ts`),
      and that line is **not** in the cache prefix.
- [ ] The budget guard (§3.4) logs a warning when catalogue+knowledge would exceed the stuff limit, and
      Stage M still answers correctly for every under-budget tenant.
- [ ] **Stage N:** for an over-budget tenant, ingestion embeds+stores chunks; a query retrieves top-k;
      retrieved chunks appear in the **dynamic tail** (verified: the cache prefix is byte-identical between
      two different queries for the same tenant); the answer is grounded in the retrieved chunks.
- [ ] `knowledge_chunks` is tenant-isolated — a two-tenant retrieval test never returns another tenant's
      chunks, with no policy change beyond the Stage-N migration.
- [ ] Embedding calls (ingest + query) are metered into `usage_logs` with the embedding model name.

---

## 8. How this feeds the Phase-2 client dashboard

Like doc 09/10/11, Stage M is **built agency-side now but is the client-dashboard surface** for Phase-2
logins (doc 10 §9): the **Knowledge / FAQ / Hours intake cards** become the client's own "About my
business" settings, carried over with no rewrite (RLS already scopes `tenants`). The only remaining work is
the single doc-10 §9 routing change. Stage N's ingestion is agency/automated and equally tenant-scoped.

---

## 9. Build order for Sonnet

**Stage M (structured KB — no external calls, ship now):**
1. **M1** — migration `0014` (`knowledge_base`, `business_hours`, `timezone`); hand-edit `database.ts`;
   extend `Tenant` domain type + `mapTenant`.
2. **M2** — intake wizard: **Knowledge/FAQ** card (FAQ repeater + policy fields) and **Hours** card
   (day/open/close grid + timezone); server action writes all three columns (JSON-validated, the doc-10
   catalogue-JSON pattern).
3. **M3** — `buildKnowledgeBlock` in `promptBuilder` gated on a non-empty `knowledge_base` (§3.2),
   deterministic serialisation; render the static hours table (§4.2); extend the budget guard (§3.4).
4. **M4** — `services/hours.ts` pure helper + orchestrator injection of the dynamic open-now line in the
   tail (§4.3); unit tests across timezones/edge times.

**Stage N (pgvector retrieval — Phase 3 scale path):**
5. **N1** `[OPUS]` — ✅ **DECIDED & FROZEN in §5.5 (Opus, 2026-07-16):** the retrieval design — chunking
   strategy, `text-embedding-3-small`, migration `0015` (`knowledge_chunks` + hnsw index + the
   service-role-only `match_knowledge_chunks` `SECURITY DEFINER` RPC/grants), top-k + retrieved-context
   token budget, and the **dynamic-tail placement** of retrieved chunks in `promptBuilder` `mode:'retrieve'`
   (§5.5). Then build the ingestion (`services/knowledge.ts` + `services/ai/embed.ts`) and query plumbing
   mechanically — no further Opus pass needed.

---

`[OPUS]` gates recap — one, a retrieval-quality + cache-correctness + index-security decision:
- **N1** — ✅ **DECIDED (§5.5, 2026-07-16):** the whole `pgvector` retrieval design (§5) — chunking,
  `text-embedding-3-small`, hnsw ANN index, the service-role-only `match_knowledge_chunks` RPC/grants,
  top-k + budget, and the **dynamic-tail** placement of query-dependent retrieved chunks (never in the cache
  prefix, §1.3).

**This doc's only `[OPUS]` gate is now cleared — Stages M and N are both Sonnet-buildable.** Stage M is
already shipped; Stage N builds against §5.5 with no further Opus pass.
