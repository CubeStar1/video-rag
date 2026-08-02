# Video RAG — Implementation Plan

Turn the existing AI-SDK chat template into a **video RAG workspace**: users create a project, upload
videos into it, the videos get indexed in VideoDB, and an agent answers questions about them by calling
retrieval tools that return timestamped, playable evidence.

---

## 1. Architecture

```
Next.js frontend  ──►  /api/agent (AI SDK, tools)  ──►  FastAPI backend  ──►  VideoDB SDK
       │                                                      │
       ├──► Supabase Storage (video files → public URL)        └──► Supabase (service role: status writeback)
       └──► Supabase DB (projects, conversations, messages, videos)
```

**Ingest flow**

1. User creates a project (already works).
2. In the project workspace they upload video files **or** paste direct/YouTube URLs.
3. Files go to Supabase Storage bucket `project-assets` at `{projectId}/videos/{uuid}-{name}` → public URL.
4. Next route `POST /api/videos` inserts a `videos` row (`status='pending'`) and calls FastAPI `POST /api/videos/ingest`.
5. FastAPI: `coll.upload(url=...)` → stores `videodb_video_id`, duration, thumbnail, stream URL back to the row
   (`status='indexing'`), then runs the understand → index pipeline in a background task, writing progress into
   `videos.index_status` and finally `status='ready'` (or `'failed'` + `error`).
6. Workspace polls `GET /api/videos?projectId=…` and shows per-video state.

**Query flow**

1. Chat box has a video picker ("@"/attach-style) listing the current project's *ready* videos.
2. Selected `videodb_video_id`s are sent in the request body; `/api/agent` also injects the project's full
   video inventory into the system prompt so the agent always knows what exists.
3. Agent calls retrieval tools → Next tool → FastAPI → VideoDB → shots with timestamps + HLS stream URLs.
4. Tool results render inline as compact cards: answer + cited moments with `mm:ss` timestamps.
5. When the result is *watchable* — "show me clips of…", a highlight reel, the moments behind an answer — the
   agent additionally calls `show_clips`, which opens the **artifact panel** with a dedicated clip-reel
   component (player + clip list) instead of dumping URLs into chat.

**Collection strategy:** use the account's **default collection** (`conn.get_collection()`) for every video.
`create_collection()` is plan-gated on free accounts, so per-project collections are not reliable. Project
scoping is done in our own DB: every retrieval call passes an explicit list of `videodb_video_id`s, and the
backend fans out over them and merges results. This is also exactly what the "tag videos in the chat box"
flow needs.

---

## 2. Database & storage

### `lib/supabase/migrations/schema.sql` (append)

```sql
CREATE TABLE IF NOT EXISTS public.videos (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  source_type text NOT NULL DEFAULT 'upload',      -- 'upload' | 'url'
  storage_path text NULL,                           -- set for 'upload'
  source_url text NOT NULL,                         -- public URL handed to VideoDB
  videodb_video_id text NULL,
  videodb_collection_id text NULL,
  stream_url text NULL,
  player_url text NULL,
  thumbnail_url text NULL,
  duration numeric NULL,
  status text NOT NULL DEFAULT 'pending',           -- pending|ingesting|indexing|ready|failed
  index_status jsonb NULL,                          -- { analyzers: [...], indexes: [...], step, message }
  error text NULL,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT videos_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_videos_project_id ON public.videos(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_videodb_id ON public.videos(videodb_video_id)
  WHERE videodb_video_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_videos_updated_at ON public.videos;
CREATE TRIGGER update_videos_updated_at BEFORE UPDATE ON public.videos
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own videos" ON public.videos;
CREATE POLICY "Users can manage own videos" ON public.videos
FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

Storage: reuse the existing **public** `project-assets` bucket (policies already in place). The backend writes
status with the service-role key, which bypasses RLS.

> Supabase caps uploads at 50 MB per file by default. The upload dialog will surface this and the URL-ingest
> tab is the escape hatch for larger files. Raising the limit is a dashboard setting, noted in the README.

---

## 3. FastAPI backend (`backend/`)

```
backend/
  requirements.txt          # fastapi, uvicorn[standard], videodb>=0.5.0, supabase, pydantic-settings, python-dotenv
  .env.example              # VIDEO_DB_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ALLOWED_ORIGINS
  README.md                 # setup + run instructions
  app/
    main.py                 # FastAPI app, CORS, /health, routers
    config.py               # pydantic-settings
    clients.py              # cached videodb.connect() + collection, supabase service client
    schemas.py              # pydantic request/response models
    services/
      ingest.py             # upload + understand→index pipeline + status writeback
      retrieval.py          # search / ask / semantic_search / query / aggregate / transcript / clip
    routers/
      videos.py
      retrieval.py
```

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness + VideoDB auth check |
| POST | `/api/videos/ingest` | `{db_video_id, source_url, title}` → upload to VideoDB, return ids/duration/thumbnail/stream, kick off background indexing |
| GET | `/api/videos/{videodb_id}` | details: duration, stream URL, indexes present |
| GET | `/api/videos/{videodb_id}/status` | understanding/index build status |
| POST | `/api/videos/{videodb_id}/reindex` | re-run the pipeline |
| DELETE | `/api/videos/{videodb_id}` | delete from VideoDB |
| GET | `/api/videos/{videodb_id}/transcript` | `?start=&end=` → transcript text |
| POST | `/api/retrieval/search` | `{video_ids[], query, top_k, return_fields?}` → merged shots + compiled stream |
| POST | `/api/retrieval/ask` | `{video_ids[], question, top_k}` → `{answer, sources[]}` |
| POST | `/api/retrieval/semantic-search` | `{video_ids[], query, index_names[], score_threshold, top_k}` |
| POST | `/api/retrieval/query` | `{video_id, index_name, filter, limit, sort}` — exact filters |
| POST | `/api/retrieval/aggregate` | `{video_id, index_name, group_by, metric}` — counts/facets |
| POST | `/api/retrieval/clip` | `{video_id, timestamps:[[s,e]]}` → `{stream_url, player_url}` |

Every shot in a response is normalised to:
`{video_id, db_video_id, title, start, end, text, score, stream_url}` plus
`player_url = https://console.videodb.io/player?url={stream_url}`.

### Indexing pipeline (`services/ingest.py`)

Per the VideoDB skill's v2 path:

```python
understanding = video.understand(
    transform={"resolution": "480p"},                    # cost control
    segmentation={"type": "shot", "threshold": 30, "min_scene_len": 15},
    analyzers=[
        {"type": "spoken_words", "name": "transcript"},
        {"type": "vlm", "name": "scene",
         "sampling": {"strategy": "uniform", "frame_count": 4},
         "config": {"model": "basic",
                    "prompt": "Describe the scene, who/what is visible, the setting, "
                              "any on-screen text, and what is happening.",
                    "schema": {"scene_description": "text",
                               "on_screen_text": "text",
                               "activity": {"type": "enum", "values": [...]},
                               "setting": {"type": "object", "fields": {...}}}}},
    ],
)
```

Then poll `understanding.refresh().list_analyzers()` (guarding against the empty-list `all([])` trap, since a
`partial` run never satisfies `wait_until_complete()`), index each `analyzer.is_successful` artifact with
`video.index(source=analyzer, name=analyzer.name)`, and also call `video.index_spoken_words(force=True)` so
`get_transcript_text()` / subtitles work. Status is written to Supabase after each step. Runs in a
`BackgroundTasks` job; indexing can take many minutes, which is why the UI polls.

---

## 4. Next.js API routes

| File | Purpose |
|---|---|
| `app/api/videos/route.ts` | `GET ?projectId=` list rows; `POST` upload-registration → calls backend ingest |
| `app/api/videos/[videoId]/route.ts` | `GET` refresh status from backend + persist; `DELETE` remove from VideoDB + storage + row |
| `app/api/videos/[videoId]/reindex/route.ts` | `POST` re-run indexing |
| `lib/videodb/backend-client.ts` | typed `fetch` wrapper over `VIDEODB_BACKEND_URL` (default `http://localhost:8010`) |
| `lib/supabase/upload-project-video.ts` | browser upload to `project-assets` → public URL |

All routes auth-check via `getUser()` and verify project/video ownership, mirroring `app/api/projects/route.ts`.

---

## 5. Agent tools (AI SDK)

New directory `app/api/agent/tools/videodb/`, one file per tool + an `index.ts` registry:

| Tool | Input | Returns |
|---|---|---|
| `list_project_videos` | — (project from context) | id, title, duration, status, indexes — so the agent can resolve names → ids |
| `search_video_moments` | `video_ids[]`, `query`, `top_k` | timestamped shots + compiled clip URL |
| `ask_video` | `video_ids[]`, `question` | grounded answer + source moments |
| `get_video_transcript` | `video_id`, `start?`, `end?` | transcript text |
| `semantic_search_video` | `video_ids[]`, `query`, `index_names[]`, `score_threshold` | precise index-targeted search |
| `query_video_index` | `video_id`, `index_name`, `filter` | exact structured filtering |
| `aggregate_video_index` | `video_id`, `index_name`, `group_by` | counts / facets ("how many scenes show a car") |
| `create_video_clip` | `video_id`, `timestamps[]` | playable clip URL for highlight/answer evidence |
| `show_clips` | `title`, `clips[]`, `compiled_stream_url?`, `identifier?` | opens the artifact panel with the clip-reel UI (see §5a) |

Registered in `app/api/agent/route.ts` alongside `show_artifact`. `stopWhen: stepCountIs(15)` stays.

### 5a. `show_clips` → artifact panel

The artifact store already supports custom UI (`ArtifactState.ui: React.ReactNode`, `displayType: 'custom'`,
`setArtifactUI(...)`), so this needs no store changes — it follows the existing `show_artifact` pattern exactly.

**Tool** — `app/api/agent/tools/videodb/show-clips.ts`. Like `show_artifact` it is a pass-through: it just
echoes its input so the client can render it. Input schema:

```ts
{
  title: string,                    // "Clips: moments where pricing is discussed"
  identifier?: string,              // stable id so re-showing reuses the same panel
  compiled_stream_url?: string,     // all matches concatenated — the "Play all" source
  clips: Array<{
    label?: string,                 // short caption for the moment
    video_id: string,               // videodb id
    video_title?: string,
    start: number, end: number,     // seconds
    text?: string,                  // transcript / scene snippet
    score?: number,
    stream_url: string,             // HLS for this clip
    thumbnail_url?: string,
  }>
}
```

The agent fills `clips` from whatever `search_video_moments` / `ask_video` / `create_video_clip` returned —
those tools already surface `stream_url` per shot, so no extra backend round-trip is needed.

**Component** — `app/agent/components/artifact-panels/clip-reel-panel.tsx` (standalone, takes the clip array
as props, no store coupling — reusable outside the panel):

- Sticky **player** at the top: `VideoPlayer` (hls.js) bound to the selected clip's `stream_url`, with the
  clip's title, `mm:ss – mm:ss` range, and source video name underneath.
- **Play all** button when `compiled_stream_url` is present — swaps the player to the concatenated stream.
- Scrollable **clip list** below: numbered rows with thumbnail (when available), time range, duration,
  relevance score pill, and the snippet text. Clicking a row loads it into the player; the active row is
  highlighted.
- Per-clip overflow actions: *Copy stream URL*, *Open in VideoDB player*
  (`https://console.videodb.io/player?url=…`).
- Empty/loading states; graceful fallback to the console-player iframe if hls.js fails (e.g. Safari native HLS).

**Wiring** — `app/agent/components/tool-displays/static/show-clips-result.tsx`, mirroring
`show-artifact-result.tsx`:
- `ShowClipsAutoOpen` — on `output-available`, builds `<ClipReelPanel …/>` and calls
  `showArtifact(ui, { title, displayType: 'custom', identifier, metadata: { kind: 'clips', count } })` once.
- `ShowClipsResult` — the inline chat card: film icon, title, "N clips", and an Open/Close toggle that
  re-opens the same panel.
- Registered in `static-tool-display.tsx`'s `STATIC_TOOLS` map (`Film` icon, `text-rose-500`) with cases in
  `renderToolResult` / `renderToolHeadless`.

**Small tweak to `artifact-panel.tsx`**: pick the header icon from `metadata.kind` so clip artifacts show a
`Film` icon, and hide the Copy button for `displayType: 'custom'` (there is no text content to copy).

**`/api/agent` changes**
- Accept `selectedVideoIds?: string[]` from the client.
- Load the project's video inventory from Supabase server-side.
- Pass both into `getSystemPrompt`.
- Register the VideoDB tools.

**System prompt rewrite** (`app/agent/lib/ai/system-prompt.ts`) — replaces the generic assistant text:
- Role: video-RAG analyst answering questions about the user's indexed videos.
- Renders the video inventory (title → `videodb_video_id`, duration, status) and the currently tagged videos.
- Rules: never answer from memory about video content — always retrieve first; prefer `ask_video` for
  "what/why" questions and `search_video_moments` for "find the moment where…"; always cite `mm:ss`
  timestamps; call `create_video_clip` when the user wants to watch the evidence; use
  `aggregate_video_index`/`query_video_index` for counting and exact-attribute questions; if a video is still
  indexing, say so rather than guessing; if no video is tagged and several exist, ask which one (or search
  across all tagged/ready ones).
- **Clip rule:** whenever the answer is something to *watch* — the user asks for clips/moments/a highlight
  reel, or the retrieved evidence is worth playing — call `show_clips` after the retrieval tool, passing the
  shots' `stream_url`s. Never paste raw HLS or console-player URLs into the chat; the panel is where clips
  live. Keep the accompanying chat message to a short summary with timestamps.

---

## 6. Frontend UI (VideoDB-console-like)

### Project workspace — `app/projects/[projectId]/page.tsx` (currently a redirect → becomes the workspace)

Layout matching the reference screenshots:
- Top-right **Upload file** button (accent-coloured).
- Centred project title with a folder icon.
- Large rounded **prompt box** ("Ask anything across your videos…") with Attach + model chip and a send button.
  Submitting creates a conversation and routes to `/projects/{id}/conversations/{conversationId}`.
- **Suggestion cards** grid (Search & find / Summarise & understand / Clip & highlight / Ask across videos) —
  clicking one prefills the prompt.
- **Media library** below: `Video` tab, search-by-title input, responsive card grid with thumbnail, duration
  badge, title, and an index-status pill (`Indexing…` with spinner / `Ready` / `Failed` + retry).

New components under `app/projects/[projectId]/components/`:
`workspace-client.tsx`, `upload-dialog.tsx`, `media-grid.tsx`, `video-card.tsx`, `prompt-launcher.tsx`,
`suggestion-cards.tsx`.

**Upload dialog** mirrors screenshot 2: drag-and-drop zone, "Or add file URLs" repeatable input,
"Add files to <project>" field, Cancel/Upload footer, and an **In Progress** tab showing per-file progress.

`hooks/use-project-videos.ts` — TanStack Query list + 5s polling while any video is `pending|ingesting|indexing`.

### Chat additions

- `app/agent/components/video-picker.tsx` — popover listing the project's ready videos with checkboxes;
  selections render as removable chips above the textarea and are sent as `selectedVideoIds`.
- `app/agent/components/agent-chat.tsx` — mount the picker in `PromptInputTools`, thread `selectedVideoIds`
  into the `sendMessage` body, and drop attachments-only phrasing in favour of video context.
- `app/agent/components/video-player.tsx` — shared HLS player (`hls.js`, new dependency) exposing
  `seekTo(seconds)` so timestamp citations jump to the moment. Used by both the clip-reel panel and the
  workspace. Falls back to the VideoDB console-player iframe if hls.js can't attach.

### Artifact panel

- `app/agent/components/artifact-panels/clip-reel-panel.tsx` — the clip UI described in §5a, rendered inside
  the existing `ArtifactPanel` via `displayType: 'custom'`.
- Directory is set up so future custom panels (e.g. a transcript reader) drop in alongside it.

### Inline tool result displays

`app/agent/components/tool-displays/static/`:
- `video-search-result.tsx` — compact list of moments (`mm:ss – mm:ss`, snippet, score).
- `video-ask-result.tsx` — answer text + collapsible source moments.
- `show-clips-result.tsx` — auto-open + Open/Close card for the clip-reel panel (§5a).
- `video-list-result.tsx`, `video-transcript-result.tsx`, `video-aggregate-result.tsx` (simple table/list).

Registered in `static-tool-display.tsx`'s `STATIC_TOOLS` map with icons/colours, following the existing
`show_artifact` pattern.

---

## 7. Config

`frontend/env.example` + `.env.local`:
```
VIDEODB_BACKEND_URL="http://localhost:8010"
```
`backend/.env`:
```
VIDEO_DB_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ALLOWED_ORIGINS=http://localhost:3000
```
`frontend/package.json`: add `hls.js`.

---

## 8. Build order

1. **Schema + storage** — extend `schema.sql`, run it in Supabase.
2. **Backend** — scaffold FastAPI, ingest + retrieval services, verify against a real video from a script.
3. **Next API routes + upload** — storage upload, ingest registration, status polling.
4. **Workspace UI** — VideoDB-style project page, upload dialog, media grid.
5. **Agent** — tools, system prompt rewrite, `/api/agent` wiring, video picker in the chat box.
6. **Player + clip artifact** — `video-player.tsx`, `clip-reel-panel.tsx`, `show_clips` tool +
   `show-clips-result.tsx`, artifact-panel icon/copy tweak.
7. **Inline tool displays** — search / ask / transcript / aggregate result cards.
8. **Docs & cleanup** — `backend/README.md`, root README with end-to-end run instructions, and **delete
   `frontend/ARCHITECTURE.md`** (stale doc from the previous CI/CD project).

## 9. Manual test checklist

- Create project → upload a short MP4 → row appears `indexing` → flips to `ready`.
- Paste a YouTube URL → ingests without touching Supabase Storage.
- Tag the video in chat → "what is this video about?" → `ask_video` runs, answer cites timestamps.
- "find the moment where X happens" → `search_video_moments` → inline moments list.
- "show me clips of X" → retrieval + `show_clips` → artifact panel opens with the reel; clicking a clip row
  swaps the player; "Play all" plays the compiled stream; closing and re-opening from the chat card works.
- "how many scenes are outdoors?" → `aggregate_video_index`.
- Ask about an un-indexed video → agent reports it is still indexing instead of hallucinating.

## 10. Things I need from you

1. **`VIDEO_DB_API_KEY`** — put it in `backend/.env` (free key at https://console.videodb.io, 50 uploads).
2. **`SUPABASE_SERVICE_ROLE_KEY`** for the backend (`NEXT_PUBLIC_SUPABASE_ADMIN` in `.env.local` looks like it
   already is the service key — I'll reuse that value unless you say otherwise).
3. Confirm the backend port `8010` is fine (8000/8001 are referenced by the old CI/CD config).
