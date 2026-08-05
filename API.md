# API reference

Three layers, each wrapping the one below it:

```
Agent tool (AI SDK, TypeScript)
   └─► Next route  /api/videos/*        ── Supabase rows, ownership checks
   └─► backend-client.ts                ── typed fetch to FastAPI
          └─► FastAPI  /api/videos/*, /api/retrieval/*
                 └─► VideoDB Python SDK
                        └─► VideoDB cloud
```

This document covers all three: what each endpoint is for, what it sends into VideoDB, and
what comes back.

**Base URL** — the FastAPI service runs on `VIDEODB_BACKEND_URL` (default `http://localhost:8000`).

---

## Contents

- [Concepts](#concepts) — collection, video, understanding, analyzer, artifact, index, shot
- [The shapes everything shares](#the-shapes-everything-shares) — `ShotOut`, status values
- [Ingestion endpoints](#ingestion-endpoints) — `/api/videos/*`
- [Retrieval endpoints](#retrieval-endpoints) — `/api/retrieval/*`
- [VideoDB SDK cheat sheet](#videodb-sdk-cheat-sheet) — every SDK call we make
- [Agent tools](#agent-tools) — what the model sees
- [Next.js routes](#nextjs-routes) — what the browser calls

---

## Concepts

| Term | What it is |
|---|---|
| **Collection** | A bucket of videos in your VideoDB account. We use the **default collection** for everything (`conn.get_collection()`) — `create_collection()` is plan-gated on free accounts. |
| **Video** | One uploaded media item. Identified by a VideoDB id like `m-abc123…`. Carries `stream_url`, `length`, `thumbnail_url`. |
| **Understanding** | One *run* of analysis over a video. Contains one or more analyzers. Async — takes minutes. |
| **Analyzer** | One kind of signal extraction (`spoken_words`, `vlm`, `object_detection`, `ocr`, …). Each produces an **artifact**. |
| **Artifact** | The analyzer's output: a list of timestamped scenes, each with a `data` dict. |
| **Index** | An artifact turned into something retrievable. Declares capabilities via `use_for`: `semantic`, `query`, `aggregate`. |
| **Shot** | A retrieved moment: a video id + `start`/`end` in seconds + text + score, and a playable stream URL. |

**We build one index per analyzer**, each named after it. Every analyzer runs on
VideoDB's own prompt and output shape — we pick only the model tier and the frame
budget — so the field names below come from the platform, not from a schema of ours:

| Index name | From analyzer | Holds | Good for |
|---|---|---|---|
| `transcript_v2` | `spoken_words` | `text` | what was **said** |
| `scene_v2` | `vlm` | `text` | what was **shown** |
| `ocr_v2` | `ocr` | `text` | text **on screen** |
| `objects_v2` | `object_detection` | `summary`, `frames.detections.label`, `frames.detections.score` | what is **in frame** |
| `activity_v2` | `activity_recognition` | `activity`, `labels`, `actions` | what is **happening** |
| `location_v2` | `location_detection` | `location`, `location_type`, `setting`, `time_of_day` | **where** it happens |
| `brands_v2` | `brand_detection` | `brand_names`, `summary` | logos and **sponsorships** |

Because the names are identical across videos, one search can fan out over many of them.

**The VLM runs on its default prompt, so `scene` is prose and nothing else** — a VLM
given no prompt and no schema writes a description into a single `text` field. The
longer field lists in the VideoDB docs are what it emits *when you give it a schema*.
Everything structured comes from the task-specific analyzers instead, which is why
they are all enabled.

Every analyzer in a run shares one segmentation, so rows from different indexes line
up on the same `start`/`end` — that is how the studio timeline merges `scene`, `ocr`,
`objects`, `activity` and `location` into a single strip.

### The `_v2` suffix, and why a name can never be reused

An index name is a **schema contract across the whole collection**. Two videos whose
artifacts have different field shapes cannot share a name; the second is rejected at
create time with `index name '…' already exists in this collection with a different
scene structure`.

**Deleting the index frees the name; deleting the video does not.** Verified against a
live account:

| Action | Name reusable with a different shape? |
|---|---|
| `index.delete()` | **yes** — recreating it with different keys is accepted |
| `collection.delete_video()` | **no** — the indexes are orphaned but keep holding the name |

That asymmetry is the trap. A deleted video's indexes survive it and stay bound to their
names, and because nothing can reach them any more (`get_video` returns *Video not
found*) they can never be deleted — so the name is stuck with its old field shape
permanently. `DELETE /api/videos/{id}` therefore deletes the indexes *before* the video.

The bare `scene` and `transcript` names are already lost this way, which is what the
generation suffix is for — `INDEX_GENERATION` in the backend settings and
`INDEX_GENERATION` in `frontend/lib/videodb/indexes.ts`, which **must match**. Bump both
to claim a fresh set after any change to the analyzer configuration.

**`fields` does not help here.** It is tempting to think declaring
`fields={"semantic": ["text"], "filter": []}` pins the contract. It does not: `fields`
chooses which *stored* fields get retrieval optimisation, while VideoDB stores every
key on the record regardless, and the contract is on what is stored. Verified live —
two record sets declaring identical `fields`, differing only by an extra `words` key,
and the second was rejected. Hence `PINNED_FIELDS` in `ingest.py`, which projects the
records themselves before indexing.

A new collection would also work — the contract is scoped to one collection, and
`conn.create_collection()` is available. It is not worth the migration: it would mean
plumbing a collection id through `clients.py` and re-ingesting every video, to gain two
tidier names. Everything therefore stays in the account's default collection.

---

## The shapes everything shares

### `ShotOut` — every retrieved moment

Returned by `/search`, `/ask` (as `sources`), `/semantic-search`, and `/query`.

```jsonc
{
  "video_id":    "m-abc123",              // VideoDB video id
  "video_title": "Team standup",
  "start":       124.5,                    // seconds
  "end":         138.2,
  "text":        "…what the transcript or scene description says here…",
  "score":       0.83,                     // relevance; null for query()
  "stream_url":  "https://…/manifest.m3u8",// HLS for just this moment
  "player_url":  "https://console.videodb.io/player?url=…",
  "metadata":    { "indexes": { … } }      // only when return_fields was used
}
```

`stream_url` is what the clip panel plays. It is produced per shot by
`video.generate_stream(timeline=[(start, end)])`, hydrated in parallel before we respond.

### Video status values

Stored on `public.videos.status`, driven by the backend:

| Status | Meaning |
|---|---|
| `pending` | Row created, nothing sent to VideoDB yet |
| `ingesting` | Uploading the URL into VideoDB |
| `indexing` | Understanding and/or index build running |
| `ready` | At least one index reached `ready` — searchable |
| `failed` | See the `error` column |

`index_status` (jsonb) carries the detail: `{ step, message, analyzers: [...], indexes: [...] }`.

---

## Ingestion endpoints

### `POST /api/videos/ingest`

Upload a public URL into VideoDB and start indexing. **This is the only endpoint that costs
an upload against your VideoDB quota.**

**Request**
```jsonc
{
  "db_video_id": "uuid-of-the-supabase-row",  // for status writeback
  "source_url":  "https://…/video.mp4",        // or a YouTube URL
  "title":       "Team standup"
}
```

**Response** (immediate — indexing continues in the background)
```jsonc
{
  "videodb_video_id": "m-abc123",
  "collection_id":    "c-default",
  "title":            "Team standup",
  "duration":         612.4,
  "thumbnail_url":    "https://…jpg",
  "stream_url":       "https://…/manifest.m3u8",
  "player_url":       "https://console.videodb.io/player?url=…",
  "status":           "indexing"
}
```

**What it does in VideoDB**

```python
video = coll.upload(url=source_url, name=title)   # → Video
```
Then, as a background task:

```python
understanding = video.understand(
    transform={"resolution": "480p"},
    segmentation={"type": "shot", "threshold": 30, "min_scene_len": 15},
    analyzers=[
        {"type": "spoken_words", "name": "transcript"},
        {"type": "vlm", "name": "scene",
         "sampling": {"strategy": "uniform", "frame_count": 4},
         "config": {"model": "basic", "prompt": "…", "schema": { … }}},
    ],
)                                                  # → Understanding

# poll the ANALYZERS, not the run — a partial run is never terminal to the SDK
while True:
    analyzers = understanding.refresh().list_analyzers()
    if analyzers and all(a.is_complete for a in analyzers): break
    sleep(15)

for a in analyzers:
    if a.is_successful:
        video.index(source=a, name=a.name).wait_until_complete()   # → Index

video.index_spoken_words(force=True)   # v1 index — what get_transcript_text() reads
```

Progress is written to Supabase after each step. Source: [backend/app/services/ingest.py](backend/app/services/ingest.py)

**Why 480p / 4 frames / `basic`:** cost scales with scenes × frames × model tier. These are
the cheap-but-useful defaults; override via `backend/.env`.

---

### `GET /api/videos/{videodb_video_id}`

Metadata + which indexes exist. Read-only, no cost.

**Response**
```jsonc
{
  "videodb_video_id": "m-abc123",
  "title": "Team standup",
  "duration": 612.4,
  "thumbnail_url": "…",
  "stream_url": "…",
  "player_url": "…",
  "indexes": [
    { "name": "transcript", "status": "ready", "record_count": 84, "use_for": ["semantic","query","aggregate"] },
    { "name": "scene",      "status": "ready", "record_count": 41, "use_for": ["semantic","query","aggregate"] }
  ]
}
```

**SDK:** `coll.get_video(id)` → `Video`; `video.list_indexes()` → `list[Index]`.

`Index` carries `index_id, name, status, error, use_for, record_count, fields, field_schema`.
Status is `building` → `ready` | `failed`. `is_successful` means `status == "ready"` — not `"done"`.

---

### `GET /api/videos/{videodb_video_id}/status`

Live indexing progress, straight from VideoDB (independent of the Supabase row). This is what
the frontend polls indirectly.

**Response**
```jsonc
{
  "videodb_video_id": "m-abc123",
  "status": "indexing",              // ready | indexing | pending
  "step": "indexing",
  "analyzers": [ { "name": "transcript", "status": "done" },
                 { "name": "scene",      "status": "running" } ],
  "indexes":   [ { "name": "transcript", "status": "ready", "record_count": 84 } ]
}
```

**SDK:** `video.list_understandings()` → `list[Understanding]`, each `.list_analyzers()` →
`list[UnderstandingAnalyzer]` with `name`, `status`, `is_complete`, `is_successful`.
Analyzer statuses: `pending` → `running` → `done` | `failed` | `skipped`.

> `list_analyzers()` reads a **local cache** and makes no network call — call
> `understanding.refresh()` first.

---

### `POST /api/videos/{videodb_video_id}/reindex?db_video_id=…`

Re-runs the whole understand → index pipeline in the background. Use after a failure, or
after changing the analyzer config. Does **not** re-upload, so it does not cost a new upload.

---

### `DELETE /api/videos/{videodb_video_id}`

**SDK:** `coll.delete_video(video_id)`. Removes the video and its indexes from VideoDB. The
Next route additionally deletes the Supabase Storage object and the DB row.

---

### `GET /api/videos/{videodb_video_id}/transcript?start=&end=`

Plain-text transcript, optionally windowed.

**Response** `{ "videodb_video_id": "…", "start": 60, "end": 120, "text": "…" }`

**SDK:** `video.get_transcript_text(start=…, end=…)` → `str`. Reads the **v1** spoken-word
index built by `index_spoken_words()`, not the v2 `transcript` artifact — which is why the
ingest pipeline builds both. Returns 409 if the video has no transcript yet.

---

## Retrieval endpoints

All of these are cheap and repeatable — indexing is the expensive step.

Every multi-video endpoint takes `video_ids: string[]` and fans out over them in a thread
pool (max 6 concurrent), merging and re-ranking by score. One video failing never blocks the
rest; its message lands in `errors[]`.

### `POST /api/retrieval/search` — "find the moment where…"

Natural language. **VideoDB plans the retrieval itself** and decides which indexes to read.
This is the general-purpose entry point.

**Request**
```jsonc
{ "video_ids": ["m-abc123"], "query": "where they discuss the deadline", "top_k": 8 }
```

**Response**
```jsonc
{
  "query": "…",
  "shots": [ ShotOut, … ],
  "compiled_stream_url": "https://…/manifest.m3u8",  // all matches concatenated
  "compiled_player_url": "https://console.videodb.io/player?url=…",
  "errors": []
}
```

**SDK:** `video.search(query, top_k=…)` → **`SearchResponse`**

```python
response.response_type   # "shots" | "deepsearch" | "aggregate"
response.shots           # list[Shot] — empty when response_type == "aggregate"
response.results         # SearchResult for shots; raw dict/list for aggregate
response.warnings
response.compile()       # → stream URL; raises SearchError if empty
```

> **Gotchas.** `SearchResponse` has **no `.stream_url`** (that was the old `SearchResult`) —
> use `.compile()`. An analytical question can come back as `response_type == "aggregate"`
> with zero shots; we detect that and return an empty list rather than crashing.
> Passing `index_name` / `index_names` / `index_ids` to `search()` raises `ValueError` —
> use `/semantic-search` for that.

`compiled_stream_url` is built by POSTing to VideoDB's `compile` path with
`[{video_id, shots: [(start, end)]}, …]`, which is why it can span multiple videos.

---

### `POST /api/retrieval/ask` — "what / why / summarize"

Retrieves evidence and writes an answer grounded in it. **This is the default for questions.**

**Request** `{ "video_ids": ["m-abc123"], "question": "What did they decide?", "top_k": 12 }`

**Response**
```jsonc
{
  "question": "…",
  "answer":   "They decided to postpone the launch…",
  "sources":  [ ShotOut, … ],
  "errors":   []
}
```

**SDK:** `video.ask(question, top_k=…, mode="default", include_sources=True)` → **`AskResponse`**
with `.answer: str`, `.sources: list[Shot]`, `.warnings`.

> `ask()` reads **v2 indexes only** — it does not fall back to v1. With multiple videos we
> call it per video and concatenate the answers, each headed by its video title (a single
> video gets no heading).

---

### `POST /api/retrieval/semantic-search` — targeted vector search

Use when you know *where* the answer lives, or you need a relevance floor.

**Request**
```jsonc
{
  "video_ids": ["m-abc123"],
  "query": "someone writing on a whiteboard",
  "index_names": ["scene"],        // omit to search every semantic index
  "top_k": 8,
  "score_threshold": 0.7            // only available here, not on search()
}
```

**Response** — same shape as `/search`.

**SDK:** `video.semantic_search(query, index_names=[…], top_k=…, score_threshold=…, filter=…)`
→ **`SearchResult`** (`.shots`, `.stream_url`, `.player_url`, `.compile()`, `.get_shots()`).

A dotted path targets **one field's** embeddings instead of the whole record — the sharpest
tool in the retrieval API:

```python
index_names=["scene.scene_description"]
index_names=["location.location_type"]
```

Singular `index_name` / `index_id` are **not** accepted here — only the plural forms.

---

### `POST /api/retrieval/query` — exact filtering

No natural-language interpretation. Exactly one index.

**Request**
```jsonc
{
  "video_id": "m-abc123",
  "index_name": "objects",
  "filter": [
    { "field": "frames.detections.label", "op": "==", "value": "laptop" },
    { "field": "frames.detections.score", "op": ">", "value": 0.8 }
  ],
  "limit": 50
}
```

**Response** — a bare `ShotOut[]`.

**SDK:** `video.query(index_name=…, filter=…, limit=…, sort=…)` → `SearchResult`.

Operators: `==`, `!=`, `contains`, `in`, `exists` (string fields; numeric/array differ —
read `index.field_schema[field].operators` rather than guessing). A list of conditions is
ANDed; `and` / `or` / `not` compose. A dotted path crossing a list matches when **any**
element satisfies it.

Which fields are filterable is derived from the data at index time rather than declared
by us — read `index.field_schema[field].operators` rather than guessing. In practice the
short-label fields are the useful ones: `activity` on `scene` and `activity`,
`location_type` / `time_of_day` on `location`, `frames.detections.label` on `objects`,
`brand_names` on `brands`.

> `query()` needs stored rows but not embeddings, so it works on a `building` index once
> ingest lands — but immediately after `index()` there may be no rows at all.

---

### `POST /api/retrieval/aggregate` — counts and facets

**Request**
```jsonc
{ "video_id": "m-abc123", "index_name": "scene", "group_by": "activity", "metric": "count", "limit": 50 }
```

**Response** `{ "index_name": "scene", "group_by": "activity", "metric": "count", "rows": [ { … }, … ] }`

**SDK:** `video.aggregate(index_name=…, group_by=…, metric="count", filter=…, limit=…)` →
**raw server payload**, typed `dict | list[dict]`. Not a `SearchResult`: no `.get_shots()`,
no `.compile()`, and no guarantee of a `results` key — we guard with `isinstance` and
normalise to a row list.

> When `group_by` crosses a list (e.g. `frames.detections.label`), it is ambiguous whether
> you are counting *scenes containing* the value or *occurrences of* it. Grouping on a
> top-level field like `activity` has no such ambiguity — prefer those.

This has no v1 equivalent; previously you fetched every scene and counted client-side.

---

### `POST /api/retrieval/clip` — build a playable clip

**Request** `{ "video_id": "m-abc123", "timestamps": [[120, 145], [300, 318]] }`

**Response**
```jsonc
{
  "video_id": "m-abc123",
  "stream_url": "https://…/manifest.m3u8",
  "player_url": "https://console.videodb.io/player?url=…",
  "timestamps": [[120, 145], [300, 318]]
}
```

**SDK:** `video.generate_stream(timeline=[(start, end), …])` → `str`.

Ranges are clamped to `start >= 0` and dropped when `end <= start` — a negative timestamp
silently produces a broken stream otherwise.

---

### `GET /health`

`{ "status": "ok" | "degraded", "videodb": "ok" | "error: …", "supabase": "ok" | "error: …" }`

Run this first when something isn't working.

---

## VideoDB SDK cheat sheet

Everything we call, in one place. Full docs: `.agents/skills/videodb/`.

| Call | Returns | Used by |
|---|---|---|
| `videodb.connect(api_key=…)` | `Connection` | startup |
| `conn.get_collection()` | `Collection` (default) | everything |
| `coll.upload(url=…, name=…)` | `Video` | ingest |
| `coll.get_video(id)` | `Video` | everything |
| `coll.delete_video(id)` | `None` | delete |
| `video.understand(analyzers, segmentation, transform, sampling)` | `Understanding` | ingest |
| `understanding.refresh()` / `.list_analyzers()` | `Understanding` / `list[UnderstandingAnalyzer]` | ingest polling |
| `video.index(source, name)` | `Index` | ingest |
| `index.wait_until_complete(timeout, poll_interval)` | `Index` | ingest |
| `video.index_spoken_words(force=True)` | — | ingest |
| `video.list_indexes()` / `list_understandings()` | `list[Index]` / `list[Understanding]` | status |
| `video.search(query, top_k)` | `SearchResponse` | `/search` |
| `video.ask(question, top_k, include_sources)` | `AskResponse` | `/ask` |
| `video.semantic_search(query, index_names, top_k, score_threshold)` | `SearchResult` | `/semantic-search` |
| `video.query(index_name, filter, limit, sort)` | `SearchResult` | `/query` |
| `video.aggregate(index_name, group_by, metric, limit)` | `dict \| list[dict]` | `/aggregate` |
| `video.generate_stream(timeline)` | `str` | `/clip`, shot hydration |
| `video.get_transcript_text(start, end)` | `str` | `/transcript` |
| `shot.generate_stream()` | `str` | shot hydration |

### Object shapes

```python
Video:  id, collection_id, stream_url, player_url, name, description,
        thumbnail_url, length, transcript, transcript_text, scenes

Shot:   video_id, video_length, video_title, start, end, text, search_score,
        scene_index_id, scene_index_name, metadata, stream_url, player_url

Index:  index_id, video_id, name, status, error, use_for, source,
        record_count, fields, field_schema
        .is_successful  ⇒  status == "ready"

Understanding:        id, status, video_id, collection_id, analyzers
        .is_successful  ⇒  status == "done"
UnderstandingAnalyzer: id, name, status
        .is_complete    ⇒  status in terminal set
```

### Traps worth remembering

| Trap | Reality |
|---|---|
| `search()` result has no `.stream_url` | `SearchResponse` ≠ `SearchResult`. Call `.compile()` |
| `wait_until_complete()` on an understanding hangs | A run with one failed analyzer ends `partial`, which isn't terminal. Poll the analyzers |
| `all(a.is_complete for a in [])` is `True` | A refresh can transiently return an empty list — guard with `analyzers and …` |
| `analyzer.type` doesn't match what you sent | `spoken_words` reports `"speech_transcription"`. Match on `.name`, which is yours |
| Index named `vlm-3f2a91bc` | You passed `name=analyzer.name` for an **unnamed** analyzer. Name every analyzer, or pass no `name=` at all |
| Empty search results | v2 returns an empty response; only `legacy_search()` raises. But `.compile()` on empty raises `SearchError` |
| Indexing "should be done by now" | A 102-second clip with 5s segmentation and 3 analyzers has run past 30 minutes |

---

## Agent tools

What the model sees. Defined in [frontend/app/api/agent/tools/videodb/](frontend/app/api/agent/tools/videodb/).

| Tool | Input | Calls | Purpose |
|---|---|---|---|
| `list_project_videos` | — | Supabase only | Resolve a video named in words → its VideoDB id; check what's searchable |
| `ask_video` | `video_ids`, `question`, `top_k` | `/ask` | **Default.** What / why / summarize |
| `search_video_moments` | `video_ids`, `query`, `top_k` | `/search` | Find the moment where… |
| `semantic_search_video` | `video_ids`, `query`, `index_names`, `score_threshold` | `/semantic-search` | Targeted: speech vs. visuals |
| `query_video_index` | `video_id`, `index_name`, `filter` | `/query` | Exact attribute filtering |
| `aggregate_video_index` | `video_id`, `index_name`, `group_by` | `/aggregate` | How many / how often |
| `get_video_transcript` | `video_id`, `start`, `end` | `/transcript` | Exact wording, quotes (truncated at 12k chars) |
| `create_video_clip` | `video_id`, `timestamps[]` | `/clip` | Highlight reel from ranges |
| `show_clips` | `title`, `clips[]`, `compiled_stream_url` | *nothing* | Opens the artifact panel. Pass-through — the clips were already retrieved |

`show_clips` makes no network call: it echoes its input so the client can render
`ClipReelPanel` in the artifact panel. Same pattern as `show_artifact`.

The project's video inventory (title, id, duration, status) is injected into the system
prompt on every turn, so the agent knows what exists without calling `list_project_videos`
first.

---

## Next.js routes

What the browser calls. All auth-checked via `getUser()` and scoped by `user_id`.

| Route | Purpose |
|---|---|
| `GET /api/videos?projectId=` | List a project's videos (polled every 5 s while any are indexing) |
| `POST /api/videos` | Register an upload or URL → insert row → call backend `/ingest` |
| `GET /api/videos/{id}` | Refresh status from the backend and persist the change |
| `DELETE /api/videos/{id}` | Delete from VideoDB + Storage + DB |
| `POST /api/videos/{id}/reindex` | Re-run indexing (re-ingests if never uploaded) |
| `POST /api/agent` | Chat stream. Accepts `selectedVideoIds`, loads the video inventory, registers the tools |

`POST /api/videos` body:
```jsonc
{ "projectId": "uuid", "title": "…", "sourceUrl": "https://…", "storagePath": "…", "sourceType": "upload" | "url" }
```

`sourceUrl` must be **publicly reachable** — VideoDB fetches it server-side. That is why the
`project-assets` bucket is public.
