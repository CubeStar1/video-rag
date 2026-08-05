# VideoMind on Supabase — schema and migration plan

Everything `core` writes today lives under `data/`: video files in `uploads/`, one
JSON record per video in `records/`, and an embedded Qdrant collection in
`vectordb/`. This document specifies a **new Supabase database** that replaces all
three, and the change required in each pipeline file.

Nothing about *analysis* changes. Embeddings are still produced locally by
`BAAI/bge-small-en-v1.5` on the GPU — Supabase stores the vectors, it does not
make them.

## Scope

This database holds the pipeline and nothing else. Projects, users, auth and chat
belong to the application; `project_id` appears here only as an **opaque tag** the
caller supplies — no foreign key, no `projects` table, no validation.

Core is the only client. It connects with the service-role key, so there is no
row-level security to design: the browser never talks to this database, it talks
to core's HTTP API, which is where scoping is enforced.

Six tables, one SQL function.

---

## 1. What moves where

| Today | Becomes |
|---|---|
| `data/uploads/*.mp4` | Storage bucket `videos` (private), one row in `videos` |
| `record["video_id"]` (sha1 of bytes) | `videos.content_hash`; `videos.id` (uuid) is the new public id |
| `record["video"]`, `chunk_config`, `preset`, `params` | `videos` — one chunking per video, as today |
| `record["chunks"][i]` `{id,start,end}` | `chunks` |
| `record["chunks"][i][analyzer_id]` | `chunk_analyses.output` + facet columns |
| Qdrant point payload | the same `chunk_analyses` row — the payload was a denormalised copy of it |
| Qdrant named vectors (5 per point) | `chunk_embeddings`, one row per (analysis, field) |
| `record["aggregates"]` | `aggregates`, one row per aggregator |
| `record["aggregates_analyzers"]` | `aggregates.analyzers_snapshot`, per row |
| `api/jobs.py` in-memory dict | `jobs` |
| `data/models/yolo11n.pt`, HF caches | **stay local.** Regenerable, machine-specific, not state |

Two known limitations in `CLAUDE.md` disappear as a side effect: payload indexes
are real in Postgres (embedded Qdrant ignored them), and jobs survive a restart.

---

## 2. Design decisions

**Chunking config lives on `videos`.** A video has one chunking, which is exactly
what a record holds today — re-chunking replaces it. A separate `chunk_runs` table
would let several chunkings of one video coexist, which the vector store was
built for but nothing has ever used. If that becomes real, extracting the columns
into their own table is a contained change; carrying the join now is not worth it.

**Named vectors become rows, not columns.** Qdrant's five named vectors per point
map to five rows in `chunk_embeddings` keyed `(analysis_id, field)`. This preserves
the current semantics exactly — *a chunk with no `people` text has no `people`
vector and is therefore excluded from a people-scoped search*, which is correct
behaviour. Five nullable `vector(384)` columns would need dynamic SQL to pick one
per query and a migration per new vector space.

**`chunks` stays separate from `chunk_analyses`.** Chunking is its own stage:
chunks exist before any analyzer runs, and a chunk no analyzer had anything to say
about is still a real chunk that `GET /videos/{id}/chunks` returns today. It is a
five-column table; folding it away would make a chunk's existence depend on an
analyzer having produced output for it.

**One SQL function, and it only does the vector part.** `match_chunks` takes the
query embedding, the field, and the hard scope (project, videos, analyzers) and
returns ids and scores. Every other filter — objects, tags, people, speakers,
people counts, time ranges — is applied in Python over the fetched rows. Ranking by
distance is the one thing Postgres does enormously better than shipping vectors
over the wire; predicate matching is not, and keeping it in Python means
`FILTER_SPEC` stays the single source of truth with no SQL to keep in sync.

**Filters are applied by over-fetching.** `match_chunks` is asked for
`limit × OVERFETCH` rows and Python truncates after filtering. Video and analyzer
scoping — present in essentially every real query — is passed into SQL, so the
over-fetch only has to absorb facet filters, which are rare. The failure mode is
honest and visible: a very selective facet filter can return fewer than `limit`
rows, fixed by raising `OVERFETCH`.

**Score stays cosine similarity, 0–1.** pgvector's `<=>` is cosine *distance*, so
the function returns `1 - distance`. The measured thresholds in `ENDPOINTS.md`
(~0.55–0.60 separates present from absent content) remain valid unchanged.

**`project_id` sits on the tables that are queried directly** — `videos`,
`chunk_embeddings` (so the vector query can scope without a join) and `jobs`.
`chunks`, `chunk_analyses` and `aggregates` are always reached through a video, so
they do not carry it.

**Enforcing project scope is now core's job, not the database's.** There is no RLS
to catch a query that forgets it. The mitigation is a single choke point: the
repository layer takes `project_id` once at construction and injects it into every
query, so no call site can omit it.

**The bucket is private; `/media` redirects to a signed URL.** The corpus is
surveillance footage — a public bucket makes a leaked path a permanent
unauthenticated feed. `GET /media/{video_id}` mints a short-lived signed URL per
request and 307s to it, so expiry is invisible to the player.

**Decode still needs a local file.** `frames.py` seeks once per chunk then walks
forward with `grab()`/`retrieve()`; `audio_extract` decodes the whole track. Both
accept a URL, but each analyzer's re-open would refetch over HTTP — the measured
22x seek penalty becomes a network penalty. Ingest downloads the object once into
a content-hash-keyed local cache and runs the whole pipeline against that path.

---

## 3. Schema

```sql
create extension if not exists vector with schema extensions;

-- -------------------------------------------------------------------- videos
create table public.videos (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null,            -- opaque; owned by the application
  title        text not null,
  source_url   text,                     -- original URL, when ingested from one
  storage_path text,                     -- '{project_id}/{video_id}/{filename}'
  content_hash text not null,            -- sha1(bytes)[:16] — video_id_for()
  duration     numeric,
  size_bytes   bigint,
  status       text not null default 'pending',
  error        text,
  analyzers    text[] not null default '{}',

  -- The chunking this video's chunks and vectors came from.
  chunk_config text,                     -- config_key(): 'audio_video:5-20', 'interval:10'
  mode         text,                     -- preset | weights | interval
  preset       text,
  weights      jsonb,
  interval_seconds numeric,
  min_duration numeric,
  max_duration numeric,
  chunk_count  int not null default 0,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- Re-ingesting the same bytes into a project is the same video, whatever it is
-- called. This is what makes ingest idempotent.
create unique index idx_videos_project_hash on public.videos (project_id, content_hash);
create index idx_videos_project on public.videos (project_id, created_at desc);

-- -------------------------------------------------------------------- chunks
create table public.chunks (
  id          uuid primary key default gen_random_uuid(),
  video_id    uuid not null references public.videos(id) on delete cascade,
  chunk_index int not null,              -- record["chunks"][i]["id"]
  start_s     double precision not null,
  end_s       double precision not null,
  unique (video_id, chunk_index)
);

-- ----------------------------------------------------------- chunk analyses
-- One analyzer's output for one chunk. `output` is verbatim, including the
-- `_frames` and `locations` keys the API strips unless verbose=true. The columns
-- beside it are the facets queries filter on.
create table public.chunk_analyses (
  id           uuid primary key default gen_random_uuid(),
  chunk_id     uuid not null references public.chunks(id) on delete cascade,
  video_id     uuid not null references public.videos(id) on delete cascade,
  analyzer_id  text not null,            -- registry-owned: no enum, no check
  chunk_index  int not null,
  start_s      double precision not null,
  end_s        double precision not null,
  output       jsonb not null,
  embed_text   text,                     -- render_fields()['combined']
  description  text,
  setting      text,
  people       text[] not null default '{}',
  objects      text[] not null default '{}',
  actions      text[] not null default '{}',
  tags         text[] not null default '{}',
  speakers     text[] not null default '{}',
  people_count int,
  created_at   timestamptz not null default now(),
  unique (chunk_id, analyzer_id)
);
create index idx_analyses_scope on public.chunk_analyses (video_id, analyzer_id, chunk_index);

-- --------------------------------------------------------- chunk embeddings
-- One row per named vector. A missing row means that field was not rendered,
-- which is what excludes the chunk from a field-scoped search.
create table public.chunk_embeddings (
  id          uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.chunk_analyses(id) on delete cascade,
  video_id    uuid not null references public.videos(id) on delete cascade,
  project_id  uuid not null,
  analyzer_id text not null,
  field       text not null,             -- VECTOR_FIELDS, registry-owned
  embedding   extensions.vector(384) not null,
  unique (analysis_id, field)
);
-- Vectors are L2-normalised by the embedder, so cosine and inner product rank
-- identically; cosine_ops is kept because the API reports cosine similarity.
create index idx_embeddings_hnsw
  on public.chunk_embeddings using hnsw (embedding extensions.vector_cosine_ops);
create index idx_embeddings_scope on public.chunk_embeddings (project_id, field, analyzer_id);

-- ---------------------------------------------------------------- aggregates
create table public.aggregates (
  id                 uuid primary key default gen_random_uuid(),
  video_id           uuid not null references public.videos(id) on delete cascade,
  aggregator_id      text not null,      -- registry-owned
  result             jsonb not null,
  analyzers_snapshot text[] not null,    -- what existed when this ran; staleness check
  computed_at        timestamptz not null default now(),
  unique (video_id, aggregator_id)
);

-- ---------------------------------------------------------------------- jobs
create table public.jobs (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  video_id   uuid references public.videos(id) on delete cascade,
  kind       text not null,              -- ingest | aggregate | reindex
  status     text not null default 'queued',
  stage      text,
  detail     jsonb not null default '{}',
  result     jsonb,
  error      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_jobs_project on public.jobs (project_id, created_at desc);

-- ------------------------------------------------------------------ triggers
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger touch_videos before update on public.videos
  for each row execute function public.touch_updated_at();
create trigger touch_jobs before update on public.jobs
  for each row execute function public.touch_updated_at();
```

Status and kind are plain `text`, not enums — adding a stage should not need an
`ALTER TYPE`. `analyzer_id`, `aggregator_id` and `field` are text with no check
constraint for a stronger reason: their value sets live in
`analyzers/__init__.py`, `aggregators/__init__.py` and `render.py`. `CLAUDE.md`
promises that adding an analyzer touches one module and one registry line, and
constraining them here would quietly make that "…and a database migration".

### Storage

```sql
insert into storage.buckets (id, name, public) values ('videos', 'videos', false);
```

No bucket policies: only core touches it, with the service-role key. Paths are
`{project_id}/{video_id}/{filename}`, and `/media/{video_id}` hands out signed
URLs.

### The one SQL function

```sql
create or replace function public.match_chunks(
  query_embedding extensions.vector(384),
  p_project_id    uuid,
  p_field         text   default 'combined',
  p_video_ids     uuid[] default null,
  p_analyzer_ids  text[] default null,
  match_limit     int    default 50
)
returns table (analysis_id uuid, score double precision)
language sql stable as $$
  select e.analysis_id, 1 - (e.embedding <=> query_embedding)
  from public.chunk_embeddings e
  where e.project_id = p_project_id
    and e.field = p_field
    and (p_video_ids    is null or e.video_id    = any(p_video_ids))
    and (p_analyzer_ids is null or e.analyzer_id = any(p_analyzer_ids))
  order by e.embedding <=> query_embedding
  limit match_limit;
$$;
```

Python then fetches those analyses in one `select … in (ids)` and applies the rest
of `FILTER_SPEC` itself.

Novelty needs raw vectors, and that is a plain table read — no function:
`chunk_embeddings` filtered by `video_id`, `analyzer_id` and `field='combined'`,
joined to `chunk_analyses` for the descriptions. PostgREST returns a `vector` as a
string like `"[0.1,0.2,…]"`, so it needs one `json.loads` on the way in.

---

## 4. Pipeline changes, file by file

### New — `videomind/db/`

| Module | Contents |
|---|---|
| `client.py` | Cached `supabase.Client` from `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. Fails loudly at import if unset |
| `repo.py` | One class, constructed with `project_id`, holding every query: `upsert_video`, `get_video`, `list_videos`, `resolve_by_hash`, `replace_chunks`, `bulk_upsert_analyses`, `get_chunks`, `upsert_aggregate`, `get_aggregates`, job CRUD. The `project_id` it was built with is injected into every call, which is what stops a query from forgetting the scope |
| `media.py` | `local_path_for(video)` — download from Storage into `CACHE_DIR/{content_hash}.mp4` if absent; `ingest_source(url_or_file)` — stream, sha1 as the bytes land, upload to Storage; `signed_url(video, ttl)` |
| `record.py` | `load_record(video_id) -> dict` — rebuilds exactly the dict shape `AggregateContext` expects |

Dependency: `supabase>=2` — PostgREST and Storage over HTTPS, no direct database
port to open.

`record.py` is what keeps this migration small: all twelve aggregators read
`ctx.record["chunks"][i][analyzer_id]` and `ctx.record["analyzers"]`. Rebuilding
that dict from two queries means **none of them change** except `novelty.py`.

### `paths.py`
Drop `RECORDS_DIR` and `VECTOR_DIR`. Add `CACHE_DIR` (`VIDEOMIND_CACHE`, default
`data/cache`) for downloaded media; keep `MODEL_DIR`. `UPLOAD_DIR` stays only for
local-dev files on their way to Storage.

### `store.py`
Reduce to the in-memory record builder used during one ingest run. `save()` and
`load()` go; `build()` and `attach()` stay, because `upload()` still assembles a
record in memory before writing it out in bulk.

### `vectordb/store.py` — the largest rewrite
Keep the class name and every method signature, so `api/core.py` and the
aggregators do not care what is underneath.

- `__init__` — takes `project_id`, holds the repo. No collection to create; the
  migration owns the schema. `close()` becomes a no-op kept for the
  context-manager protocol, and the comment about the embedded storage lock goes
  with it.
- `FILTER_SPEC` is unchanged and still the single source of truth.
  `build_conditions()` — which built Qdrant `FieldCondition`s — becomes
  `apply_filters(rows, filters)`, a pure function evaluating the same `any` /
  `exact` / `gte` / `lte` kinds over dicts. Unknown-key validation and `_suggest()`
  are untouched, and still the reason a typo is a 400 rather than silently-wrong
  results. Being a pure function over dicts, it is also the first part of this
  code that is trivially unit-testable.
- `search()` — `rpc("match_chunks", …)` with the hard scope and
  `limit * OVERFETCH`; fetch those analyses in one call; `apply_filters`; apply
  `score_threshold`; truncate to `limit`. Rows come back with the same keys
  `_shape()` already reads, so `api/core.py:_shape` is untouched.
- `add_chunks()` — same batched embed pass, then upsert analyses, read back ids,
  upsert embeddings. The facet extraction that currently builds the Qdrant payload
  moves onto the analyses row.
- `delete_video(video_id, chunk_config, extractor_id)` — a scoped `DELETE`. The
  rationale is unchanged: deleting by video alone would wipe every other
  analyzer's rows.
- `point_id()` — gone. `unique (chunk_id, analyzer_id)` and
  `unique (analysis_id, field)` express the same idempotency.
- New: `vectors_for(video_id, analyzer_id)` for novelty.

`config_key()` and `VECTOR_FIELDS` are unchanged.

### `api/core.py`
Every `record_path_for()` + `json.loads()` pair becomes a repo call, and every
entry point gains `project_id`.

| Function | Change |
|---|---|
| `video_id_for` | Hashes while streaming the download instead of reading a local file; the hash resolves to a row via `resolve_by_hash` |
| `upload` | Takes `video_id` or `{url, project_id}`. Resolves a local path via `db.media`, chunks, writes the chunking columns and chunks, then per analyzer: delete old rows, analyze, bulk upsert. "Reuse the record when chunk_config matches" becomes comparing `videos.chunk_config`; "chunk boundaries changed, drop the vectors" becomes deleting the video's chunks, which cascades. The filename-stem record naming disappears |
| `list_videos` | One select, scoped by project |
| `record_path_for` | Deleted |
| `video_path_for` | Becomes `db.media.local_path_for`. The "path stopped resolving because the data dir moved" fallback is no longer needed — Storage is the source of truth |
| `get_video` | Single row |
| `get_chunks` | Filters, `limit`/`offset` and `total` push into SQL instead of loading the whole record and slicing. `_strip` still runs on the way out |
| `get_chunk` | Single-row select |
| `run_aggregators` | `load_record()`, then persist per aggregator instead of rewriting a record. Staleness compares `analyzers_snapshot` per row |
| `get_aggregates` | Select from `aggregates`; the "video has no such aggregate, it has […]" message is a second cheap select |
| `get_entities` (in `app.py`) | Unchanged — still filters and merges timelines in Python from the two stored aggregates |
| `query` | Unchanged apart from the store beneath it, plus `project_id` |
| `answer` | Per video `load_record` and the existing routing. Unchanged otherwise |

### `aggregators/`
- `base.py` — `AggregateContext` keeps its `record` dict; add `project_id`.
- `novelty.py` — the only aggregator that changes. It currently calls
  `ctx.store.client.scroll(COLLECTION, limit=10_000, with_vectors=True)`, pulling
  **every point in the database** and filtering in Python. In a shared database
  that is a correctness problem as well as a cost one; replace with
  `ctx.store.vectors_for(ctx.video_id, analyzer_id)`.
- Everything else — unchanged. Results are persisted by `run_aggregators`, not by
  the aggregators themselves.

### `api/jobs.py`
Same public API (`create`, `update`, `get`, `all_jobs`, `run_in_background`),
backed by the `jobs` table; `create()` takes `project_id` and `video_id`. Keep
progress writes coarse — per stage and per analyzer, as now.

### `api/app.py`
- `POST /videos` — primary path becomes JSON `{video_id}` or `{url, project_id}`;
  the browser uploads straight to Storage, which also sidesteps the 50 MB body cap
  `PLAN.md` flags. Keep multipart for local dev.
- `GET /media/{video_id}` — 307 to a signed Storage URL. The hand-rolled
  `Range`/`206` handling goes; Storage does it correctly and the bytes stop
  transiting the Python process.
- `GET /videos`, `POST /query`, `POST /ask` — take `project_id`.
- `/health` — add a Supabase reachability check.
- `/schema` — unchanged; still generated from `FILTER_SPEC`.

### `analyzers/base.py`
`VideoContext(video_path)` still takes a local path — it just comes from the media
cache now. Add `VideoContext.for_video(video)` to resolve it.

### `scripts/reindex.py`
Rebuilds from `chunk_analyses.output` instead of `records/*.json`: delete
`chunk_embeddings` for the target scope, re-run `render_fields`, re-embed, insert.
Still costs no API calls, which was the point. The `shutil.rmtree(VECTOR_DIR)` at
the top becomes a scoped `DELETE` — as written it wipes the entire vector store,
which is not acceptable once the store is shared.

---

## 5. Frontend and `backend/`

The application keeps its own database for projects, auth and chat; nothing there
changes except what it talks to. 23 frontend files reference VideoDB columns:
`lib/videodb/*` becomes a thin client for core, the four `app/api/videos/*` routes
and the seven `app/api/agent/tools/videodb/*` tools retarget at `/query`, `/ask`,
`/videos/{id}/chunks` and `/videos/{id}/aggregates`, and `videodb_video_id` /
`stream_url` become core's `id` and `/media/{id}`. `search-video-moments` maps onto
`/query` with `detail=minimal`, which is what that detail level exists for.

`backend/` exists only to wrap the VideoDB SDK. Once the tools call core, it has no
remaining job — core is already a FastAPI service of the same shape. Delete it
rather than keep a second service writing to the same tables.

---

## 6. Rollout

1. Create the Supabase project; run the schema above as
   `supabase/migrations/0001_videomind.sql`. Add `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` to `core/.env`.
2. Build `videomind/db/`, `record.py` first — it is the shim the rest leans on.
3. Rewrite `vectordb/store.py` behind its existing interface. Verify parity by
   ingesting `media/test.mp4` and comparing `/query` scores against the current
   Qdrant build on the same queries: same embeddings, same cosine metric, so they
   should agree to ~1e-6.
4. Convert `api/core.py`, then `jobs.py`, then `app.py`. Verify against a **live
   server**, per `CLAUDE.md` — several bugs here only ever appeared over HTTP.
5. Re-ingest rather than backfill. `data/records/` does not exist on this machine,
   the Qdrant payloads were derived from those records, and the old project's
   videos are VideoDB-indexed with nothing VideoMind can reuse. Re-uploading the
   three files in `data/uploads/` costs one analysis run each.
6. Cut the frontend over, delete `backend/`, delete `data/records/` and
   `data/vectordb/`.

---

## 7. Things this surfaces

**`people` is two different types.** The Qdrant payload sets both
`"people": output.get("people", [])` and `"persons": output.get("people", [])`.
For `default_video` that key is a list of strings; for the `people` analyzer it is
a list of person *objects*. JSON hid this; `text[]` cannot. Proposal: `people
text[]` holds short labels only — the scene analyzer's strings, and for the people
analyzer a derived `role + clothing` label per person — while the full records stay
in `output` and are still served as `persons` at `detail=full`. The `people` filter
then means the same thing for both analyzers, which today it does not.

**Scoping is only as good as the repo layer.** With no `projects` table there is
no RLS backstop; a query that omits `project_id` returns other tenants' data. This
is the reason for the single repo object holding the id — worth a test that asserts
every public method filters on it.

**Embedding dimension is now schema.** `vector(384)` pins `bge-small-en-v1.5`.
Moving to `bge-base` (768) means a new column plus a full reindex, not a config
change. Worth deciding before ingesting a corpus.

**Concurrent ingest of the same file** is prevented by
`unique (project_id, content_hash)`, but two simultaneous runs would still both
analyze. `pg_advisory_xact_lock(hashtext(content_hash))` around the upsert is the
cheap fix.

**Storage lifecycle is a real question.** Deleting a `videos` row cascades through
Postgres but does not touch the object in the bucket. Core should delete the object
in the same operation, or a scheduled job should sweep orphans.

**Deferred, deliberately.** Two tables from an earlier draft were cut as
speculative and are worth naming so they can come back on evidence rather than
taste: `entities` (normalising the entity aggregates so the UI can query people
directly, rather than filtering the jsonb in Python as the code does today) and
`doc_embeddings` (storing summary-section and entity vectors so `/ask` stops
re-embedding all of them on every question — a latency fix, not a correctness one).
