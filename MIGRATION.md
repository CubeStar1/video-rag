# VideoDB → core migration plan

Replacing the VideoDB pipeline (`backend/` + the `videos` table) with `core/`
(VideoMind). Written after reading both sides end to end; every file named here
exists today.

The single fact that drives the whole redesign: **core returns mp4 URLs, not HLS
streams.** VideoDB handed the frontend a `stream_url` per moment — an HLS
manifest that *was* the clip. Core has one mp4 per video and a `(start, end)`
pair per hit. Everything that plays, previews, or copies a URL changes shape,
not just its data source.

---

## 0. What is where today

| | Frontend (Next.js) | `backend/` | `core/` |
|---|---|---|---|
| Supabase | **project A** — `projects`, `conversations`, `messages`, `videos`, bucket `project-assets` (public) | writes status back into A | **project B** — bucket `videos` (public). No DB tables yet |
| Video identity | `videos.videodb_video_id` | VideoDB id | `video_id` = `sha1(bytes)[:16]` |
| Playback | `stream_url` (HLS), `player_url` (VideoDB console) | — | `video_url` (public mp4), `GET /media/{id}` → 307 |
| Retrieval | 7 named indexes (`scene_v2`, `ocr_v2`, …) | VideoDB SDK | 6 analyzers × 5 named vector fields + generic `filters` |
| Cross-video reasoning | none | none | 12 aggregators (`summary`, `chapters`, `events`, `entities`, `stats`, `ner`, `novelty`, …) |
| Ingest | synchronous `videodb.ingest()` | blocking | **async**: 202 + `job_id`, poll `/jobs/{id}` |
| Scoping | RLS per user, `project_id` column | — | **none** — every video is global |

`core/docs/SUPABASE.md` specifies moving core's own state (records + Qdrant) into
Supabase B. **That is a separate piece of work and this plan does not depend on
it.** Core keeps `data/records/` + embedded Qdrant throughout; the frontend talks
to core over HTTP either way, so the two migrations are independent and can land
in either order.

---

## 1. Decisions

**D1 — bytes flow A → core, playback comes from B.**
The browser keeps uploading to A's `project-assets` (existing, works, RLS'd), and
the frontend hands core the resulting public URL via `POST /videos/url`. Core
downloads, hashes, and re-uploads into B's `videos` bucket — which is exactly
what that route already does, so **zero core changes for the handoff**, and the
two-Supabase problem disappears: neither project ever needs credentials for the
other. The mp4 the player loads is B's public URL, stored on the row as
`playback_url`.

The bytes exist in both projects and **stay in both** — A's object is not purged
after ingest. `video_core.source_url` keeps pointing at it, so a wiped core
bucket is recoverable by re-running ingest from the original URL, and A's copy
remains the object the browser uploaded and can re-fetch without core running at
all. Storage cost is the price; it is the deliberate choice.

Core's `videos` bucket **stays public**. `playback_url` is therefore a permanent,
unsigned mp4 link, which is what makes D3 work: `Range` seeking, media-fragment
deep links and per-clip poster frames all hit Storage directly with no token to
refresh and no expiry to survive mid-playback.

*Rejected:* posting the file straight to core (`POST /videos` multipart) pushes
whole videos through Next's body cap and core's process; core's own docs advise
against it.

**D2 — the frontend is the authority on scope.**
Core has no `project_id` and no auth. Every core call from a Next route passes an
explicit `video_ids` list resolved from `video_core` rows the caller owns, and
**`GET /videos` on core is never used for listing** — the project's inventory is
`video_core`. Add a shared-secret header (`X-Core-Token`) to core so a reachable
:8077 is not an open corpus. Core-side `project_id` can arrive later with
SUPABASE.md without changing any of this.

**D3 — a clip is a range, not a stream.**
`{ url, start, end }` replaces `stream_url` everywhere. Playback uses one
`<video>` per surface with `currentTime` seeking and a `timeupdate` boundary
guard; deep links use the media-fragment form `…/clip.mp4#t=12.5,18.0`. Supabase
Storage honours `Range`, so seeking into an mp4 is a byte-range request, not a
download. "Play all" becomes a client-side sequencer over ranges — there is no
compiled stream to fetch.

**D4 — posters are generated once, at ingest, by core.**
VideoDB supplied `thumbnail_url`. Core has none, and making the grid pull a frame
out of every mp4 client-side means N range-requests per page load. Core writes
one JPEG per video (`{video_id}/poster.jpg`, same bucket, one frame via the
existing frame reader) and returns `poster_url`. Per-clip thumbs stay
client-side — `preload="metadata"` + `#t=start` on the mp4 already has the bytes.

**D5 — `create_video_clip` is deleted, not ported.**
It existed because VideoDB could stitch ranges server-side into a new stream.
With mp4 + ranges the "clip" is data the panel already holds. Stitching would
mean re-encoding on the GPU box for a preview nobody exports.

---

## 2. `video_core` — new table in **Supabase A**

Additive: creates one table, one trigger, four policies. `videos` is left
untouched and unreferenced. Lands as
`frontend/lib/supabase/migrations/002_video_core.sql`.

```sql
CREATE TABLE IF NOT EXISTS public.video_core (
  id            uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id)      ON DELETE CASCADE,

  title         text NOT NULL,
  source_type   text NOT NULL DEFAULT 'upload',   -- upload | url
  storage_path  text NULL,                        -- object in A's project-assets
  source_url    text NOT NULL,                    -- what core was handed

  -- Core's identity. Content-derived, so the same file in two projects yields
  -- the same id — hence unique per project, never globally.
  core_video_id text NULL,
  playback_url  text NULL,                        -- public mp4 in core's bucket
  poster_url    text NULL,
  duration      numeric NULL,
  size_bytes    bigint NULL,

  -- Ingest lifecycle. `job_id` is core's in-memory job; it does not survive a
  -- core restart, which is why status is also recoverable from core_video_id.
  status        text NOT NULL DEFAULT 'pending',  -- pending|uploading|queued|analyzing|ready|failed
  job_id        text NULL,
  stage         text NULL,                        -- fetching|chunking|analyzing|indexing|aggregating|complete
  progress      jsonb NULL,                       -- last job `detail` blob
  error         text NULL,

  -- What the pipeline was asked for, replayed verbatim on re-index.
  ingest_config jsonb NULL,   -- { analyzers[], mode, preset, weights, interval, min_duration, max_duration }
  -- What it actually produced.
  analyzers     text[] NOT NULL DEFAULT '{}',
  aggregates    text[] NOT NULL DEFAULT '{}',
  chunk_config  text NULL,                        -- 'audio_video:5-20' | 'interval:10'
  chunk_count   int NOT NULL DEFAULT 0,

  created_at    timestamptz DEFAULT CURRENT_TIMESTAMP,
  updated_at    timestamptz DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT video_core_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_video_core_project ON public.video_core(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_core_job     ON public.video_core(job_id) WHERE job_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_video_core_project_core_id
  ON public.video_core(project_id, core_video_id) WHERE core_video_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_video_core_updated_at ON public.video_core;
CREATE TRIGGER update_video_core_updated_at
BEFORE UPDATE ON public.video_core
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.video_core ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own core videos" ON public.video_core;
CREATE POLICY "Users can manage own core videos"
ON public.video_core FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

Shape notes:

- `stream_url`, `player_url`, `videodb_collection_id`, `index_status`,
  `index_config` are **gone**. `index_status` was a VideoDB-shaped bag of
  per-index states; core's equivalent is flat `status`/`stage`/`progress`.
- `analyzers` and `aggregates` are `text[]`, not jsonb — the UI needs
  "does this video have `people`?" as a cheap predicate, and both value sets are
  owned by core's registries.
- `core_video_id` is nullable because it does not exist until the download
  finishes. Rows are created before core has seen a byte.

---

## 3. Core: what has to be added

Five additions. Everything else the frontend needs already exists.

| # | Change | Why |
|---|---|---|
| C1 | `DELETE /videos/{video_id}` — drop the record, the vectors (`ChunkStore.delete_video`), and the Storage object (`storage.delete`, currently written but uncalled) | The project page has a delete button. Today it would orphan bytes and vectors forever |
| C2 | Poster frame at ingest → `poster_url` on `UploadResult`, `GET /videos/{id}`, `GET /videos` | D4. One frame through the existing reader; no VLM call |
| C3 | `X-Core-Token` check (env `VIDEOMIND_API_TOKEN`, unset = open, for local dev) | D2. Core is otherwise an unauthenticated corpus on a LAN port |
| C4 | `duration` and `size_bytes` on `UploadResult` | The frontend stores both; `get_video` derives duration from the last chunk already, ingest just needs to return it |
| C5 | *(optional, later)* `filters` on `GET /videos/{id}/chunks` | The one retrieval gap — see §6, `query_video_index` |

Non-changes worth stating: `POST /videos/url`, `/jobs/{id}`, `/query`, `/ask`,
`/videos/{id}/chunks`, `/videos/{id}/aggregates`, `/videos/{id}/entities`,
`/analyzers`, `/schema` and `/media/{id}` are used **as they are**.

---

## 4. Ingest and status: async, job-driven

Today's flow is synchronous — `POST /api/videos` calls `videodb.ingest()` and
waits. Core returns 202 and a `job_id`, and the id of the video does not exist
until the download completes. New flow:

```
browser                Next route                    core
   │  upload → A ────────────────────────────────────────────►
   │  POST /api/videos { projectId, title, sourceUrl, config }
   │                    │ INSERT video_core (status=pending)
   │                    │ POST /videos/url ──────────────────► 202 { job_id }
   │  ◄── { video } ────┤ UPDATE status=queued, job_id
   │
   │  poll GET /api/videos?projectId  (5s, existing hook)
   │                    │ for each in-flight row:
   │                    │   GET /jobs/{job_id} ──────────────► { status, stage, detail, result }
   │                    │   persist stage/progress; on done:
   │                    │     core_video_id, playback_url, poster_url,
   │                    │     duration, chunk_config, chunk_count,
   │                    │     analyzers, aggregates ← result
   │                    │     status = ready
```

`useProjectVideos` already polls on `IN_FLIGHT` statuses — only the status list
changes (`pending | uploading | queued | analyzing`). The `backfillThumbnails`
pass in `app/api/videos/route.ts` is replaced wholesale by this reconcile step.

**Job loss.** Core's jobs are in-memory; a restart 404s the poll. Recovery: if
the row has a `core_video_id`, `GET /videos/{id}` on core proves it landed →
`ready`. If it does not, mark `failed` with "core restarted during ingest" and
let the existing re-index button re-run it. This case is real, not theoretical —
core is a single GPU process that gets restarted often.

**Serial ingest.** Core analyses on one GPU, in-process. Two uploads do not run
concurrently; the upload dialog should submit sequentially and say "queued"
rather than firing N parallel jobs.

**Shared bytes.** Two projects uploading the same file get the same
`core_video_id`. `DELETE /api/videos/[id]` must therefore only call core's
`DELETE /videos/{core_video_id}` when no other `video_core` row references that
id. Missing this deletes another project's corpus.

---

## 5. Frontend REST routes

`lib/videodb/` → `lib/core/`:

| New file | Replaces | Contents |
|---|---|---|
| `lib/core/client.ts` | `videodb/backend-client.ts` | Typed fetch against `CORE_API_URL` (was `VIDEODB_BACKEND_URL`), `X-Core-Token` header, `CoreApiError`. Methods: `ingestUrl`, `job`, `video`, `chunks`, `chunk`, `aggregates`, `runAggregates`, `entities`, `query`, `ask`, `analyzers`, `schema`, `remove` |
| `lib/core/types.ts` | `videodb/types.ts` | `CoreVideo`, `SearchHit`, `ChunkOut`, `AggregateResult`, `JobStatus`, `ClipRange`, and a **kept** `SceneSegment` / `VideoTimeline` (§7) |
| `lib/core/chunking.ts` | `videodb/segmentation.ts` | Modes/presets/analyzer selection + validation, replacing shot/time segmentation |
| `lib/core/format.ts` | `videodb/format.ts` | `formatTimestamp`/`formatRange`/`formatDuration` survive unchanged; `VIDEODB_PLAYER` + `toPlayerUrl` are **deleted**; add `toFragmentUrl(url, start, end)` |
| — | `videodb/indexes.ts` | **Deleted.** Index names/generation have no analogue; analyzers and vector fields come from `GET /analyzers` at runtime |

Routes:

| Route | Change |
|---|---|
| `app/api/videos/route.ts` | `GET`: read `video_core`, reconcile in-flight rows against `/jobs/{id}` (replaces `backfillThumbnails`). `POST`: insert → `POST /videos/url` → store `job_id`, no longer blocks on ingest |
| `app/api/videos/[videoId]/route.ts` | `GET`: single-row job reconcile. `DELETE`: core delete **only if last referencing row** → A storage remove → row delete |
| `app/api/videos/[videoId]/reindex/route.ts` | Re-`POST /videos/url` with stored `ingest_config` (optionally overridden in the body), reset status to `queued`, new `job_id` |
| `app/api/videos/[videoId]/timeline/route.ts` | Rewritten — §7 |
| **new** `app/api/videos/[videoId]/aggregates/route.ts` | `POST` → core `POST /videos/{id}/aggregates?force=true` (re-summarise without re-analysing; core's headline capability, currently unreachable from the UI). `GET` → cached aggregates |
| **new** `app/api/core/capabilities/route.ts` | Proxies `/analyzers` + `/schema` so the upload dialog builds its analyzer list and exclusive-group rules from the live server instead of a hardcoded constant |

Env: `VIDEODB_BACKEND_URL` → `CORE_API_URL` (`http://127.0.0.1:8077`), plus
`CORE_API_TOKEN`. Update `frontend/env.example`.

`backend/` is deleted once the tools are cut over — it exists only to wrap the
VideoDB SDK, and core is a FastAPI service of the same shape.

---

## 6. Agent tools

Nine VideoDB tools → eight core tools. The mapping is not 1:1 because core
unifies search behind one endpoint and adds a whole capability class (aggregates)
that VideoDB did not have.

| Today | Becomes | Notes |
|---|---|---|
| `list_project_videos` | `list_project_videos` | Reads `video_core` instead of `videos`. Exposes `core_video_id`, `analyzers`, `aggregates`, duration, status — the model needs to know *which* analyzers ran to pick a field |
| `search_video_moments` + `semantic_search_video` | **`search_moments`** | One tool → `POST /query`. `analyzer` (default `default_video`), `field` (`combined`\|`description`\|`people`\|`actions`\|`objects`), `filters`, `score_threshold`, `detail`, `synthesize:false`. The two old tools differed only in whether you named an index; core's `/query` takes both in one call |
| `query_video_index` | folded into `search_moments` via `filters` | `filters:{objects:['laptop'], after:60, min_people:3}`. **Gap:** core has no text-free structured filter — `/query` requires a query string. C5 (`filters` on `/videos/{id}/chunks`) closes it; until then a descriptive text plus filters is the honest substitute |
| `aggregate_video_index` | **`get_video_insights`** | `GET /videos/{id}/aggregates?aggregator=…`. Not a port — a replacement. "How busy was the store" is `stats`, "what brands" is `ner`, "what's unusual" is `novelty`, plus `summary`/`chapters`/`events`/`sentiment`/`speaker_stats` |
| — | **`get_video_entities`** *(new)* | `GET /videos/{id}/entities?min_appearances=2` — people linked across chunks with narratives and dwell time. No VideoDB equivalent existed |
| — | **`read_chunks`** *(new)* | `GET /videos/{id}/chunks?chunk_ids=2,4,7`. The second half of the pattern core is built around: `search_moments` at `detail=minimal` (~440 tokens for 5 hits) then read only what matters (~1.6k vs ~19k) |
| `get_video_transcript` | `get_video_transcript` | Backed by `GET /videos/{id}/chunks?analyzer=diarization` (falls back to `transcript`). **Gains speaker attribution** — `turns` are `{speaker, start, end, text}`, so quotes can be attributed, which the old tool could not do |
| `create_video_clip` | **deleted** | D5 |
| `show_clips` | `show_clips` | `stream_url` → `url` + `start`/`end`; `compiled_stream_url` dropped (client sequences ranges) |

`app/agent/lib/ai/system-prompt.ts` follows: `videodb_video_id` → `core_video_id`
throughout, the index catalogue is replaced by the analyzer/field/aggregator
vocabulary, rule 6 ("pass the `stream_url`") becomes "pass `url` + `start`/`end`",
and the inventory lines gain each video's analyzer set so the model stops asking
for `people` searches on videos where that analyzer never ran. `app/api/agent/route.ts`
selects from `video_core` (`core_video_id,title,duration,status,analyzers,error`).

Directory: `app/api/agent/tools/videodb/` → `app/api/agent/tools/core/`.

---

## 7. Rendering — the mp4 rewrite

This is where "no HLS" actually bites. Five components change materially.

**`app/agent/components/video-player.tsx`**
Drop `HlsJsVideo`, the `isHls` probe, and the whole VideoDB-console fallback
(`toPlayerUrl`, the "Open in VideoDB player" branch). The Video.js skin stays;
media is a plain `<Video src={mp4}>`. Add `range?: [start, end]`: seek to `start`
on `loadedmetadata`, pause (or loop) at `end` via the existing `timeupdate`
listener. That prop is what makes one player serve both a whole video and a clip.

**`clip-result-card.tsx` / `ClipThumb`**
Today each card lazily attaches an HLS stream. New behaviour: `<video
src={`${url}#t=${start}`} preload="metadata" poster={posterUrl}>` — the fragment
gives a still frame from the right moment at the cost of one range request, no
hls.js import at all. Hover starts a muted loop between `start` and `end`
(seek back on `timeupdate >= end`). "Copy stream URL" becomes "Copy link to
moment" → `url#t=start,end`. The `hls.js` dependency can leave `package.json`.

**`clip-reel-panel.tsx`**
`compiledStreamUrl` and the `PLAY_ALL` pseudo-clip go. "Play all" becomes a
client sequencer: hold an index, play range *i*, advance on the boundary guard.
Same single `<video>` — no reload between clips when the clips share a video,
which is the common case and strictly better than fetching a compiled stream.
Filter, sort, grid/list, and the `seekStudio` hand-off are unaffected.

**`video-studio-panel.tsx` + `studio-timeline.tsx` + `segment-lists.tsx`**
The `SceneSegment` / `VideoTimeline` contract is deliberately **kept** — only the
route that fills it is rewritten, so the timeline components themselves need
almost no change. `app/api/videos/[videoId]/timeline/route.ts` goes from
"query 5 VideoDB indexes and align them by time key" to a much simpler fan-out,
because core already merges analyzers per chunk:

| `SceneSegment` field | Was | Becomes |
|---|---|---|
| `description` | `scene_v2.text` | `default_video.description` |
| `tags` | `activity_v2` + `location_v2`, sentence-filtered | `default_video.tags` + `.actions` + `.setting` (already short labels) |
| `visible_objects` | `objects_v2.frames[].detections[].label` | `default_video.objects` / `object_detection.detections[].object` |
| `on_screen_text` | `ocr_v2.combined_text` | `ocr.texts[].text` |
| `transcript` | `videodb.transcript()` | `diarization.turns` (**with speakers**) or `transcript.text` |

The whole `indexRow` / `timeKey` / `tagsFrom` / `objectLabels` alignment layer —
~90 lines existing purely to reconcile VideoDB's per-index shapes — is deleted:
one `GET /videos/{id}/chunks` returns every analyzer's output already keyed by
chunk. Two lanes are worth adding while it is open, since core produces them and
VideoDB never did: **chapters** and **events** from `/aggregates`.

**`video-card.tsx` / `media-grid.tsx` / `workspace-client.tsx` / `video-picker.tsx`**
Mechanical: `thumbnail_url` → `poster_url`, `stream_url` → `playback_url`,
`videodb_video_id` → `core_video_id`, `index_status.message` → `stage`,
`describeSegmentation()` → `describeChunking()`. `agent-store.ts`'s
`seekStudio(seconds, videodbVideoId)` → `seekStudio(seconds, coreVideoId)`.

**`upload-dialog.tsx`**
The biggest UI change outside the player. Shot/time segmentation with
threshold/min-scene-len sliders is replaced by core's actual controls:

- **Analyzers** (multi-select, from `/analyzers`): `default_video`, `transcript`,
  `diarization`, `ocr`, `people`, `object_detection` — with the
  `transcript` XOR `diarization` exclusive group enforced client-side, and a cost
  hint, since `default_video` bills per chunk and `transcript` is free.
- **Chunking mode**: `preset` (`audio` / `video` / `audio_video`) · `weights`
  (speaker/silence/cut/semantic sliders) · `interval` (seconds).
- **min/max duration**, ignored when mode is `interval`.

Everything the dialog collects is stored as `ingest_config` and replayed by
re-index — same contract as today, different fields.

---

## 8. File inventory

**New** — `frontend/lib/supabase/migrations/002_video_core.sql`,
`frontend/lib/core/{client,types,chunking,format}.ts`,
`frontend/app/api/videos/[videoId]/aggregates/route.ts`,
`frontend/app/api/core/capabilities/route.ts`,
`frontend/app/api/agent/tools/core/*` (8 tools + index).

**Rewritten** — `app/api/videos/route.ts`, `app/api/videos/[videoId]/route.ts`,
`.../reindex/route.ts`, `.../timeline/route.ts`, `app/api/agent/route.ts`,
`app/agent/lib/ai/system-prompt.ts`, `app/agent/components/video-player.tsx`,
`.../artifact-panels/clip-result-card.tsx`, `.../clip-reel-panel.tsx`,
`app/projects/[projectId]/components/upload-dialog.tsx`.

**Mechanically edited** — `hooks/use-project-videos.ts`,
`hooks/use-video-timeline.ts`, `app/agent/store/agent-store.ts`,
`app/agent/components/video-picker.tsx`, `.../video-studio/*`,
`.../tool-displays/static/{show-clips-result,video-tool-results}.tsx`,
`app/projects/[projectId]/{page.tsx,components/{video-card,media-grid,workspace-client}.tsx}`,
`frontend/env.example`, root `README.md`.

**Deleted** — `frontend/lib/videodb/` (5 files),
`frontend/app/api/agent/tools/videodb/` (10 files), `backend/` (whole service).

**Core** — `videomind/api/app.py` (C1, C3), `videomind/api/core.py` (C1, C2, C4),
`videomind/storage.py` (poster upload), `core/docs/ENDPOINTS.md`, root `API.md`
and `ARCHITECTURE_DIAGRAM.md`.

---

## 9. Order of work

1. **`video_core` + core additions (C1–C4).** Verify against a live core on
   :8077 per `core/CLAUDE.md` — several bugs there only ever appeared over HTTP.
2. **`lib/core/` + the four video routes.** Upload a file end to end and watch a
   row go `pending → queued → analyzing → ready` with a real `playback_url`.
   Nothing renders yet; this is the load-bearing half.
3. **Player and clip surfaces (D3).** Cut `hls.js`/`@videojs` HLS media, add
   `range`, rebuild the reel sequencer. Verify seeking works against Supabase
   Storage ranges before touching anything else.
4. **Timeline route + studio.** The `SceneSegment` contract is unchanged, so this
   is mostly deletion.
5. **Agent tools + system prompt.** Test `search_moments` at `detail=minimal` →
   `read_chunks` and confirm the token saving is real.
6. **Upload dialog** (analyzers + chunking modes), then **delete `backend/`** and
   `lib/videodb/`.

Old `videos` rows are left in place and simply stop being read.

---

## 10. Risks and open questions

- **Core is unauthenticated and unscoped.** C3 plus explicit `video_ids` is a
  mitigation, not a boundary. Real scoping arrives with SUPABASE.md's
  `project_id`; until then, do not expose :8077 beyond the Next server.
- **Public mp4s — accepted, not open.** Anyone holding a `playback_url` can play
  that video without authenticating, and the link does not expire. This is the
  decided trade (D1): it is what buys range-seeking, `#t=` deep links and cheap
  poster frames. If it is ever revisited, note that signed URLs are a *player*
  change, not a config change — a URL expiring mid-playback breaks seeking — and
  that `GET /media/{id}` already exists as the one place that would change.
- **Byte duplication across A and B — accepted, not open** (D1). Both copies are
  kept deliberately; A's is the recovery path.
- **One GPU, in-process, serial.** Ingest throughput is one video at a time and
  a large one takes minutes. The UI must be honest about queueing.
- **In-memory jobs.** Covered in §4, but it will happen in development regularly.
- **No text-free structured filter** (C5) — the only genuine retrieval
  capability regression versus `query_video_index`.
- **Chapters can return a single chapter** on unbroken footage (core's own known
  limitation) — the new timeline lane needs an empty state, not a lone bar
  spanning the video.
