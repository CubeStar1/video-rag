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

1. **Understand** — `spoken_words` (→ `transcript`) and a schema'd `vlm` analyzer (→ `scene`),
   shot segmentation, 480p transform, 4 frames per scene.
2. **Index** — each successful artifact becomes an index named after its analyzer, so
   `transcript` and `scene` are consistent across every video and can be searched together.
3. **Transcript** — `index_spoken_words(force=True)` so `get_transcript_text()` works.

Progress is written to `public.videos.index_status` and `status`
(`pending → ingesting → indexing → ready | failed`); the frontend polls it.

Indexing is slow — tens of minutes for a long video is normal. Tune cost/quality with the
`VLM_*`, `TRANSFORM_RESOLUTION`, and `SHOT_THRESHOLD` env vars.

## Scoping

All videos go into the account's **default collection** — `create_collection()` is plan-gated
on free accounts. Project scoping lives in Supabase: callers pass explicit `video_ids` and
the service fans out over them in a thread pool, merging and re-ranking the results.
