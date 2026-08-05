# Video RAG backend

FastAPI service wrapping the [VideoDB](https://videodb.io) Python SDK. It ingests videos,
runs the understand → index pipeline, and exposes retrieval endpoints that the Next.js
agent tools call.

## Setup

```bash
cd backend
cp .env.example .env       # fill in VIDEO_DB_API_KEY + Supabase service-role creds
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

Check it came up: `curl http://localhost:8000/health` → `{"status":"ok",...}`.
Interactive docs at http://localhost:8000/docs.

## Environment

| Variable | Purpose |
|---|---|
| `VIDEO_DB_API_KEY` | VideoDB auth. Free key at https://console.videodb.io |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — background jobs write indexing status to `public.videos` (bypasses RLS) |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins (default `http://localhost:3000`) |

## Endpoints

**Ingestion** — `/api/videos`

| Method | Path | Purpose |
|---|---|---|
| POST | `/ingest` | Upload a public URL into VideoDB and start indexing in the background |
| GET | `/{id}` | Title, duration, thumbnail, stream URL, indexes |
| GET | `/{id}/status` | Live analyzer/index status from VideoDB |
| POST | `/{id}/reindex` | Re-run the understand → index pipeline |
| DELETE | `/{id}` | Remove from VideoDB |
| GET | `/{id}/transcript?start=&end=` | Plain-text transcript |

**Retrieval** — `/api/retrieval`

| Method | Path | Purpose |
|---|---|---|
| POST | `/search` | Natural-language moment search across `video_ids` |
| POST | `/ask` | Grounded answer + source moments |
| POST | `/semantic-search` | Vector search against named indexes, with `score_threshold` |
| POST | `/query` | Exact structured filtering on one index |
| POST | `/aggregate` | Counts / facets / grouping |
| POST | `/clip` | Compile timestamp ranges into one playable stream |

Every returned moment is normalised to
`{video_id, video_title, start, end, text, score, stream_url, player_url}`.

## How indexing works

`POST /api/videos/ingest` uploads the URL, then a background task runs:

1. **Understand** — seven analyzers on VideoDB's own prompts and output shapes:
   `spoken_words` (→ `transcript`), `vlm` (→ `scene`), `ocr`, `object_detection`
   (→ `objects`), `activity_recognition` (→ `activity`), `location_detection`
   (→ `location`) and `brand_detection` (→ `brands`). Shot segmentation, 480p transform,
   4 frames per scene for the VLM-backed analyzers and one frame per second for object
   detection. Only the model tier and frame budget are ours — see `build_analyzers()`.
   `OBJECT_DETECTION_MODEL` must stay `default`: naming `rtdetr-v2-r50vd` needs a running
   Sandbox Compute instance and fails the whole run without one.
2. **Index** — each successful artifact becomes an index named after its analyzer plus
   `INDEX_GENERATION` (`scene_v2`, `transcript_v2`, …), so the names are consistent
   across every video and can be searched together. `use_for` and `fields` are left to
   VideoDB, which derives them from the data and drops `semantic` on artifacts with no
   embeddable top-level text.

   An index name is a schema contract for the whole collection: two videos whose
   artifacts have different field shapes cannot share a name. `index.delete()` frees a
   name, but **deleting a video does not** — its indexes are orphaned, keep holding
   their names, and can no longer be reached to delete. That is why the delete endpoint
   drops indexes before the video, and why `INDEX_GENERATION` exists: bump it (and the
   matching constant in `frontend/lib/videodb/indexes.ts`) when a name is already lost.
3. **Transcript** — `index_spoken_words(force=True)` so `get_transcript_text()` works.

Progress is written to `public.videos.index_status` and `status`
(`pending → ingesting → indexing → ready | failed`); the frontend polls it.

Indexing is slow — tens of minutes for a long video is normal. Tune cost/quality with the
`VLM_*`, `TRANSFORM_RESOLUTION`, and `SHOT_THRESHOLD` env vars.

## Logs

A run logs milestones only, tagged with the last 8 characters of the video id:

```
22:05:17 INFO    app.routers.videos     uploaded 'demo.mp4' -> m-z-019fcd99…
22:05:17 INFO    app.services.ingest    [448e284c] understanding 7 analyzers | transcript, scene, … | shot
22:09:32 INFO    app.services.ingest    [448e284c] 3/7 analyzers done | 4m15s
22:14:19 INFO    app.services.ingest    [448e284c] understanding done in 9m02s | 7/7 ok
22:16:57 INFO    app.services.ingest    [448e284c] indexed transcript(214), scene(48), ocr(48), objects(51)
22:16:58 INFO    app.services.ingest    [448e284c] ready in 11m40s
```

The pipeline polls every 15s for tens of minutes, so progress is logged only when the
completed-analyzer count moves — never once per poll. `httpx`, `videodb` and `supabase`
are pinned to WARNING so their per-request chatter stays out of the way. Set
`LOG_LEVEL=DEBUG` for tracebacks and the suppressed HTTP detail.

## Scoping

All videos go into the account's **default collection** — `create_collection()` is plan-gated
on free accounts. Project scoping lives in Supabase: callers pass explicit `video_ids` and
the service fans out over them in a thread pool, merging and re-ranking the results.
