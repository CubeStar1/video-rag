# Endpoints

Base URL `http://127.0.0.1:8077`. Interactive docs at `/docs`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | The web UI (absent when started with `--api-only`) |
| `GET` | `/health` | Liveness, plus what this instance has loaded |
| `GET` | `/schema` | Everything searchable and filterable — read this first |
| `GET` | `/analyzers` | Registered analyzers and vector fields |
| `GET` | `/videos` | Ingested videos |
| `GET` | `/videos/{video_id}` | One video's metadata |
| `GET` | `/videos/{video_id}/chunks` | Stored analyzer output, scoped and paginated |
| `GET` | `/videos/{video_id}/chunks/{chunk_id}` | Everything produced for one chunk |
| `GET` | `/videos/{video_id}/aggregates` | Video-level results: summary, chapters, entities… |
| `POST` | `/videos/{video_id}/aggregates` | Re-run aggregators without re-analysing |
| `GET` | `/videos/{video_id}/entities` | People linked across chunks, with timelines |
| `POST` | `/videos` | Upload a video file and start ingestion |
| `POST` | `/videos/url` | Ingest a video from an http(s) URL |
| `GET` | `/jobs/{job_id}` | Job progress |
| `GET` | `/jobs` | All jobs this process has seen |
| `POST` | `/query` | Search, optionally with a synthesised answer |
| `POST` | `/ask` | Answer a question using aggregates as well as segments |
| `GET` | `/media/{video_id}` | Redirect to the video in Supabase Storage |

Everything is a read except the two ingest routes, which spend time and money.
`POST /query` and `POST /ask` are POSTs only because their bodies are too
complex for a query string — they change nothing.

---

## `GET /health`

```json
{ "status": "ok", "ui": true,
  "storage": { "ok": true, "bucket": "videos", "error": null },
  "analyzers": ["default_video", "diarization", "object_detection", "ocr", "people", "transcript"],
  "aggregators": ["chapters", "cooccurrence", "entities", "entity_timelines", "events",
                  "ner", "novelty", "object_entities", "sentiment", "speaker_stats",
                  "stats", "summary"] }
```

`ui` is false when the server was started with `--api-only`.

`status` is `degraded` when Storage is unreachable — a bad key or a missing
bucket. The server still answers reads; ingest will fail. Worth checking here
rather than discovering it minutes into a background job.

---

## `GET /schema`

What this install can do, in one call — analyzers, vector fields, detail
levels, every filter with its type, and every aggregator with its dependencies
and whether it costs API calls. Read this before constructing queries rather
than guessing field names.

```json
{
  "analyzers": [...], "exclusive_groups": [["diarization", "transcript"]],
  "vector_fields": { "combined": "whole flattened record (default)", ... },
  "detail_levels": { "minimal": "...", "standard": "...", "full": "..." },
  "filters": { "video_ids": {"type": "list[str]", "matches": "any", "payload_field": "video_id"}, ... },
  "aggregators": { "summary": {"depends_on": [], "uses_llm": true}, ... }
}
```

---

## `GET /analyzers`

The subset of `/schema` a UI needs to populate dropdowns.

```json
{
  "analyzers": ["default_video", "diarization", "object_detection", "ocr", "people", "transcript"],
  "fields": ["combined", "description", "people", "actions", "objects"],
  "exclusive_groups": [["diarization", "transcript"]]
}
```

`exclusive_groups` lists analyzer sets that cannot be selected together, so a
client can enforce it rather than discovering it as a 400.

---

## `POST /videos`

`multipart/form-data`. Returns **202** immediately — ingestion runs in the
background because it takes minutes.

Video bytes live in a Supabase Storage bucket, not on this server's disk. Both
ingest routes end the same way: the file lands in the bucket under its content
hash, and every response from then on carries a URL, never a path. Use this
route for a browser or curl; for anything large prefer `POST /videos/url`, which
does not push the video through this process.

| Field | Type | Default | Notes |
|---|---|---|---|
| `file` | file | *required* | The video |
| `analyzers` | string | `default_video` | Comma-separated ids. Chosen per upload because costs differ wildly: `default_video` bills per chunk, `transcript` is free |
| `mode` | string | `preset` | `preset` \| `weights` \| `interval` |
| `preset` | string | `audio_video` | `mode=preset` only: `audio` \| `video` \| `audio_video` |
| `speaker`,`silence`,`cut`,`semantic` | float | – | `mode=weights` only; at least one required |
| `interval` | float | – | `mode=interval` only: seconds per chunk |
| `min_duration` | float | `5` | Ignored when `mode=interval` |
| `max_duration` | float | `20` | Ignored when `mode=interval` |

**Chunking modes**

- `preset` — a named weighting of the four boundary signals.
- `weights` — your own weighting. Only the ratios among signals that actually
  fire matter; weight given to a signal producing no events is redistributed.
- `interval` — fixed spans, no detectors run. `min_duration`/`max_duration` are
  **not** applied: you asked for exact spans, so you get exactly those.

```bash
curl -X POST http://127.0.0.1:8077/videos \
  -F "file=@clip.mp4" -F "analyzers=default_video,transcript" \
  -F "mode=preset" -F "preset=video" -F "min_duration=5" -F "max_duration=20"
```

```json
{ "job_id": "d9b16a609ab1", "status": "queued", "source": "clip.mp4" }
```

Returns **400** for an unknown analyzer, an unknown mode, or a mode missing its
required parameters.

---

## `POST /videos/url`

`application/json`. Same fields as `POST /videos`, with `url` in place of
`file`. Returns **202**.

The primary path for a frontend: upload straight to Storage, then hand over the
URL. A URL that already points into our own bucket needs no special case — the
bytes still come down to be decoded, and the re-upload is skipped because the
object is already there.

```bash
curl -X POST http://127.0.0.1:8077/videos/url \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/clip.mp4","analyzers":"default_video,transcript","preset":"video"}'
```

### YouTube URLs

A YouTube link works in the same field — no separate route and no flag:

```bash
curl -X POST http://127.0.0.1:8077/videos/url \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=jNQXAC9IVRw","analyzers":"default_video"}'
```

yt-dlp resolves it to an mp4, which is then hashed, cached and uploaded to the
bucket exactly like any other video. Everything after that is identical: the
record's `filename` is the video's title, `source_url` is the link you supplied,
and `video_id` is still the hash of the bytes — so the same video ingested from
YouTube and from a file is one video, not two.

Watch, share, shorts, embed, `m.` and `music.` URLs are all accepted. Two are
refused up front, because neither can produce a video the pipeline can chunk:

| Refused | Why |
|---|---|
| A live stream | No end to chunk. Ingest the recording once it has finished. |
| Longer than `VIDEOMIND_YT_MAX_DURATION` (default 3600 s) | Analyzers bill per chunk, and a URL makes a ten-hour video a one-line mistake. Raise the variable to allow more. |

**Resolution depends on ffmpeg.** YouTube publishes 1080p as separate video and
audio streams, so joining them needs an `ffmpeg` binary on `PATH` (or at
`VIDEOMIND_FFMPEG`). Without one the best single file on offer is usually 360p —
legible enough for the scene analyzer, poor for OCR. `GET /health` reports which
you will get:

```json
{ "youtube": { "enabled": true, "ffmpeg": null, "max_quality": "360p (install ffmpeg for more)" } }
```

PyAV does not count: it bundles ffmpeg's *libraries*, not its command line
binary.

Some videos refuse anonymous clients. Point `VIDEOMIND_YT_COOKIES` at a
`cookies.txt`, or set `VIDEOMIND_YT_COOKIES_FROM_BROWSER=chrome`, to sign in.

```json
{ "job_id": "d9b16a609ab1", "status": "queued", "source": "https://example.com/clip.mp4" }
```

`video_id` is the hash of the bytes, so it does not exist until the download
finishes — it arrives in the job result, with `video_url`.

Returns **400** for a non-`http(s)` URL, for a YouTube link when yt-dlp is not
installed, and for the analyzer and mode errors above. A URL that 404s, serves an HTML error page instead of a video, or
exceeds `VIDEOMIND_MAX_BYTES` fails the **job**, not the request: the download
starts after the 202.

---

## `GET /jobs/{job_id}`

Poll until `status` is `done` or `failed`.

```json
{
  "job_id": "d9b16a609ab1",
  "status": "running",
  "stage": "analyzing",
  "detail": { "analyzer": "default_video" },
  "result": null,
  "error": null,
  "created_at": "2026-08-05T18:04:02+00:00",
  "updated_at": "2026-08-05T18:04:19+00:00"
}
```

| Field | Meaning |
|---|---|
| `status` | `queued` → `running` → `done` \| `failed` |
| `stage` | `fetching`, `chunking`, `chunked`, `analyzing`, `indexing`, `complete` |
| `detail` | Stage context, e.g. `{"chunks": 39}` or `{"analyzer": "transcript"}` |
| `result` | The **UploadResult** below, once `done` |
| `error` | Message when `failed`, else `null` |

**UploadResult**

```json
{
  "video_id": "95e110e25070fcfc",
  "video_url": "https://<project>.supabase.co/storage/v1/object/public/videos/95e110e25070fcfc/clip.mp4",
  "storage_path": "95e110e25070fcfc/clip.mp4",
  "filename": "clip.mp4",
  "chunk_config": "interval:20",
  "chunks": 2,
  "indexed": { "default_video": 2, "transcript": 0 }
}
```

`indexed` counts vectors per analyzer. A zero is normal, not an error — a
silent video produces no transcript text, so there is nothing to embed.

> Jobs live in memory. Restarting the server loses job history; ingested
> vectors and records are on disk and survive.

---

## `GET /videos`

```json
{ "videos": [ {
  "video_id": "95e110e25070fcfc",
  "filename": "clip.mp4",
  "video_url": "https://<project>.supabase.co/storage/v1/object/public/videos/95e110e25070fcfc/clip.mp4",
  "chunks": 2,
  "chunk_config": "interval:20",
  "analyzers": ["default_video", "transcript"]
} ] }
```

Only videos ingested through this API appear — the listing is built from
`records/`.

---

## `GET /videos/{video_id}/chunks`

The read counterpart to `/query`: fetch what an analyzer produced rather than
searching it. Everything is served from `records/`, so it costs nothing.

| Param | Type | Default | Notes |
|---|---|---|---|
| `analyzer` | string | all | Restrict to one analyzer's output |
| `after` / `before` | float | – | Keep chunks overlapping this time range |
| `chunk_ids` | string | – | Comma-separated ids, e.g. `2,4,7` — batch fetch after a `minimal` search |
| `limit` | int | `50` | 1–500 |
| `offset` | int | `0` | Pagination |
| `verbose` | bool | `false` | Include internal keys (see below) |

```json
{ "video_id": "...", "analyzers": ["diarization"], "total": 8,
  "offset": 0, "limit": 2,
  "chunks": [ { "chunk_id": 0, "start": 0.0, "end": 6.9,
                "timecode": "0:00.00-0:06.90",
                "diarization": { "turns": [...], "speakers": [...] } } ] }
```

By default, keys beginning with `_` (`_frames`, `_detector_labels`) and
`locations` are stripped. `locations` is per-frame box geometry only the
entity-linking pass needs — a wall of pixel coordinates is noise to anything
reading this for meaning. Pass `verbose=true` when debugging.

**400** if the video has no output from the requested analyzer (the message
lists what it does have); **404** for an unknown video.

`GET /videos/{video_id}/chunks/{chunk_id}` returns one chunk with every
analyzer's output for it.

---

## `GET /videos/{video_id}/aggregates`

Video-level results. Pass `?aggregator=summary` for one, or omit for all.

| aggregator | depends on | LLM | produces |
|---|---|---|---|
| `stats` | – | no | counts over time, busiest/quietest moment, speech totals |
| `novelty` | – | no | chunks ranked by how unlike the rest they are, plus outliers |
| `speaker_stats` | `diarization` | no | talk time, turns, handovers, share per speaker |
| `sentiment` | `diarization` | no | sentiment of spoken language, per speaker and over time |
| `ner` | – | no | named entities across speech, scene text and OCR |
| `summary` | – | **yes** | tiered summaries, finest first, plus key points and topics |
| `chapters` | – | **yes** | consecutive chunks grouped into titled sections |
| `events` | – | **yes** | discrete timestamped events with actor and category |
| `entities` | `people` | **yes** | people linked across chunks, with narratives |
| `entity_timelines` | `entities` | no | presence and dwell time per person |
| `cooccurrence` | `entities` | no | which people appear together |
| `object_entities` | `object_detection` | **yes** | objects tracked across chunks |

An aggregator whose analyzer the video lacks is **skipped, not failed** — the
entity chain needs `people`, `sentiment` and `speaker_stats` need
`diarization`.

`summary` returns a hierarchy built by halving the video until a leaf covers a
few chunks, so `tiers[0]` is the finest and the last is the whole video. Depth
follows length rather than a fixed block size; a 39-chunk video produced 4
tiers of 8 / 4 / 2 / 1 sections.

**400** if the video has no such aggregate (the message lists what it does
have); **404** for an unknown video.

---

## `POST /videos/{video_id}/aggregates`

Re-run aggregators. Returns **202** and a `job_id` to poll.

| Param | Type | Default | Notes |
|---|---|---|---|
| `aggregators` | form string | all | Comma-separated ids |
| `force` | query bool | `true` | Recompute even when already stored |

Aggregators read `records/`, not the video, so this costs no re-analysis.
Results are **cached**: with `force=false` anything already stored is reused,
which matters because `summary`, `chapters`, `events`, `entities` and
`object_entities` each bill API calls. Ingestion uses `force=false`, so
re-uploading a video to add one analyzer does not re-buy its summary.

Aggregates are recomputed automatically when the **analyzer set changes** — a
summary written before `people` ran describes a video it could not see people
in, and serving it would be confidently out of date.

```json
{ "video_id": "...", "ran": [], "reused": ["summary", "chapters", ...],
  "skipped": ["sentiment", "speaker_stats"], "failed": {},
  "llm_calls_saved": ["chapters", "entities", "events", "object_entities", "summary"],
  "recomputed_because_analyzers_changed": false }
```

---

## `GET /videos/{video_id}/entities`

People linked across chunks, each merged with its timeline when
`entity_timelines` has run.

| Param | Type | Default | Notes |
|---|---|---|---|
| `min_appearances` | int | `1` | Only people seen in at least this many chunks |

```json
{ "video_id": "...", "total": 21, "entities": [ {
  "entity_id": "6b9ca6e1-p003", "appearances": 13, "chunk_ids": [0,1,2,3,...],
  "first_seen": 0.0, "last_seen": 233.4,
  "description": "A woman in a light gray T-shirt with red lettering...",
  "narrative": "She worked the right-side checkout register...",
  "timeline": { "observed_seconds": 149.4, "spans": [...] } } ] }
```

Use `min_appearances=2` for people actually followed across the video; someone
seen once is fully described by their chunk already.

---

## `POST /query`

`application/json`.

| Field | Type | Default | Notes |
|---|---|---|---|
| `text` | string | *required* | The search query |
| `video_ids` | string[] \| null | `null` | Restrict to these videos; `null` searches all |
| `analyzer` | string | `default_video` | Which analyzer's output to search |
| `field` | string | `combined` | Named vector to search against |
| `limit` | int | `5` | 1–50 |
| `score_threshold` | float \| null | `null` | Drop weaker matches |
| `synthesize` | bool | `true` | Whether to generate an answer |
| `detail` | string | `standard` | `minimal` \| `standard` \| `full` — see below |
| `filters` | object | `{}` | Any filter from `GET /schema` |

**`filters`** is a flat dict validated against one spec, so a filter added to
the store is reachable here immediately — no plumbing. Unknown keys are a 400
with a suggestion (`Unknown filter 'speaker'; did you mean 'speakers'?`) rather
than being ignored, because a dropped filter returns plausible but wrong
results.

```json
"filters": {
  "chunk_ids": [2, 4, 7],          "video_ids": ["6b9ca6e1..."],
  "analyzer_ids": ["people"],
  "after": 60, "before": 300,      "min_people": 9, "max_people": 3,
  "objects": ["shopping cart"],    "tags": ["checkout"],
  "speakers": ["SPEAKER_00"],      "people": ["cashier"],
  "chunk_config": "interval:30"
}
```

**`detail`** controls response size, because a browser and an agent want
opposite things — five full hits measured ~19k tokens against ~440 for the
same hits at `minimal`:

| level | contents |
|---|---|
| `minimal` | ids, timecodes, score, 180-char snippet — for agents |
| `standard` | plus description and facets — what the UI renders |
| `full` | plus `text`, `persons`, `detections`, `texts` |

The agent pattern is `detail=minimal` to choose, then
`GET /videos/{id}/chunks?chunk_ids=…` to read the few that matter — roughly
1.6k tokens instead of 19k.

**`field`** picks which text the query is compared against. `combined` covers
the whole record; the others match one part, so a short precise match is not
diluted by surrounding prose. A chunk missing that field is excluded rather
than matched on empty text — a video with no people cannot surface in a
`people` search.

**`score_threshold`** — cosine similarity always ranks *something*, so without
a threshold a query for absent content returns weak neighbours instead of
nothing. Measured on sample data: present content scored ≥0.665, absent ≤0.524,
so ~0.55–0.60 separates them. Retune per field and per embedding model —
appearance queries (`field=people`) score lower than topic queries, around
0.51–0.54.

```bash
curl -X POST http://127.0.0.1:8077/query -H "Content-Type: application/json" -d '{
  "text": "man in yellow shorts walking toward the registers",
  "video_ids": ["95e110e25070fcfc"], "analyzer": "default_video",
  "field": "people", "limit": 5, "score_threshold": 0.5, "synthesize": true }'
```

```json
{
  "query": "man in yellow shorts walking toward the registers",
  "analyzer": "default_video",
  "field": "people",
  "answer": "A man in a white T-shirt and yellow shorts walks down the centre aisle toward the registers [95e110e25070fcfc 77.80-83.80s].",
  "results": [ { "...": "SearchResult" } ]
}
```

`answer` is `null` when `synthesize` is false or nothing matched — it is never
fabricated from an empty result set.

**SearchResult**

| Field | Type | Notes |
|---|---|---|
| `video_id` | string | Content hash of the source file |
| `video_url` | string | Public Storage URL of the source video |
| `chunk_id` | int | Index **within its video** — only meaningful with `video_id` |
| `start`, `end` | float | Seconds; use these to seek |
| `timecode` | string | Human form, e.g. `"1:17.80-1:23.80"` |
| `score` | float | Cosine similarity, 0–1 |
| `text` | string | The text that was embedded for `field` |
| `description` | string | Prose description |
| `people`, `objects`, `actions`, `tags` | string[] | Structured facets; empty for analyzers that do not produce them |
| `speakers` | string[] | Speakers heard in the chunk (`diarization`) |
| `turns` | object[] | `{speaker, start, end, text}` — who said what, with its own seek time |

Payload is self-sufficient — everything needed to cite a moment is here, with
no lookup into `records/`.

Returns **400** for an unknown `analyzer` or `field`.

---

## `GET /media/{video_id}`

**307** to the video in Storage, which serves the bytes and handles `Range`
itself — so seeking still works, and video no longer transits this process.

```
GET /media/95e110e25070fcfc

HTTP/1.1 307 Temporary Redirect
Location: https://<project>.supabase.co/storage/v1/object/public/videos/95e110e25070fcfc/clip.mp4
```

The bucket is public, so `video_url` in any response plays directly and this
endpoint is not required. It exists because it is the only media URL derivable
from a `video_id` alone — which is all a search hit at `detail=minimal`
carries — and because it is the one place that changes if the bucket is ever
made private. Prefer it over pasting `video_url` into a player for that reason.

**404** if the id is unknown.

---

## Core objects

**video_id** — SHA-1 of the file's bytes, first 16 hex chars. Content-derived,
not the filename, so two different files both called `test.mp4` stay separate
and re-uploading the same file is recognised as the same video.

**chunk_config** — which chunking produced a vector: `video:5-20`,
`interval:10`, or `custom-87e6230f:5-15` where the suffix hashes the weights.
Vectors are keyed on it, so one video can hold several chunkings side by side.
Without the hash two different weightings sharing a min/max would collide and
the second ingest would silently overwrite the first.

**chunk_id** — position within one video's chunk list. Not globally unique;
every video has a chunk 0. Always pair it with `video_id`. It is also not
stable across re-chunkings — chunk 12 of one run is a different moment than
chunk 12 of another — which is why vectors are keyed on `start`/`end` and
`chunk_config` instead.

**analyzer** — one analysis pass, bundling its own frame sampling, prompt and
output shape. Registered in `videomind/analyzers/__init__.py`; adding one
requires no changes to ingest, the vector store, or these endpoints.

| id | needs | produces |
|---|---|---|
| `default_video` | frames | Structured scene description: `description`, `setting`, `people`, `objects`, `actions`, `tags` |
| `transcript` | audio | Plain speech text per chunk |
| `diarization` | audio | Speaker-attributed transcript: `turns` of `{speaker, start, end, text}` plus `speakers` |
| `ocr` | frames | On-screen text: `texts` of `{text, context}` plus a `summary` |
| `people` | frames | Per person: appearance, clothing, role, action, and box `locations` |
| `object_detection` | frames | Objects in detail: `detections` of `{object, description, context}`, plus plain names in `objects` |

`transcript` and `diarization` are **mutually exclusive** — `GET /analyzers`
returns `exclusive_groups`, and selecting both is a 400. They embed the same
Whisper text (their vectors come out cosine-identical); `diarization` simply
adds speaker attribution.

`ocr` gates on cheap detection: EasyOCR's *detector* (not its recognition
stage) finds where text is, frames with none are dropped before any API spend,
near-duplicates are removed, and the remaining frames get the detected regions
boxed before a VLM reads them. It sends images at 1600px with `detail="high"`
rather than the 768px used elsewhere — at the smaller size, small or
low-contrast text is illegible and gets silently missed.

`object_detection` works the same way with YOLO as the gate, and gives each
object an appearance and a purpose rather than just a name. Its boxes are drawn
**unlabelled on purpose**: YOLO only knows COCO classes and confidently called a
thermal-imaged tank an "airplane", so writing its guess onto the image would
invite the VLM to agree with it. Unlabelled, the VLM identified the same vehicle
correctly as a tank. YOLO's labels are kept in `_detector_labels` for debugging
only.

`diarization` diarizes the **whole track once** rather than per chunk — speaker
labels are only consistent across a video if they come from a single pass,
otherwise the same person is `SPEAKER_00` in one chunk and `SPEAKER_01` in the
next. Whisper segments are then matched to whichever speaker turn overlaps them
most, since the two tools cut on different criteria and rarely align exactly.

Its vector embeds the speech **without** the `SPEAKER_00:` prefixes — labels are
for display and filtering, and inside the vector they are repeated tokens that
dilute the actual words.

**field / named vector** — each chunk is one point carrying several vectors,
one per part of its output. `people` embeds only the people list, so a people
query is compared against a short relevant string rather than the whole record.


---

## `POST /ask`

Question answering. `/query` finds segments; this answers questions, which
usually needs more than segments.

| Field | Type | Default | Notes |
|---|---|---|---|
| `question` | string | *required* | Natural-language question |
| `video_ids` | string[] \| null | `null` | Restrict to these videos |
| `analyzer` | string \| null | auto | Which analyzer's chunks to retrieve |
| `limit` | int | `6` | Supporting segments to retrieve |

The question is **routed** to the aggregates that can address it, by embedding
it against a description of what each one answers. Selection is relative — how
far a match stands above the average for that question — because absolute
thresholds do not survive real phrasing: measured score means shifted from 0.47
to 0.56 across questions, so any fixed cutoff either admitted everything or
nothing.

```
"what did the woman in the light gray shirt do"  -> entities
"which segments are unusual"                     -> novelty
"how busy was the store"                         -> stats
"what brands are visible"                        -> ner
"who was with the man in yellow shorts"          -> cooccurrence, entities
```

The context is assembled from the routed aggregates plus the video summary, the
summary sections nearest the question, and retrieved segments. Answers cite
`[video_id start-end]`, and `sources` reports what was consulted.

```json
{ "question": "...", "answer": "The woman ... [6b9ca6e1 0-24]",
  "sources": { "6b9ca6e1...": { "routed_to": ["entities"], "entities": 4, "sections": 4, "chunks": 6 } },
  "results": [ /* supporting segments */ ] }
```
