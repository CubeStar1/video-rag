# FalconVQA

**Fast Augmented Language-based CONversational Video Question Answering.**

Ask questions about your videos and get answers grounded in what was actually said and shown,
with timestamps and playable clips.

- **frontend/** — Next.js app: projects, video upload, agent chat (AI SDK), clip artifact panel
- **backend/** — FastAPI service wrapping the [VideoDB](https://videodb.io) Python SDK
- **[API.md](API.md)** — every endpoint, what goes into VideoDB, and what comes back

```
Next.js  ──►  /api/agent (AI SDK tools)  ──►  FastAPI  ──►  VideoDB
   │                                             │
   ├──► Supabase Storage (files → public URL)     └──► Supabase (status writeback)
   └──► Supabase DB (projects, conversations, messages, videos)
```

---

## 1. Prerequisites

| What | Where to get it |
|---|---|
| VideoDB API key | https://console.videodb.io — free, 50 uploads, no card |
| Supabase project | URL, anon key, and service-role key |
| A model provider key | OpenAI / Google / Groq / Cerebras / xAI (already in `frontend/.env.local`) |

## 2. Database

Run `frontend/lib/supabase/migrations/schema.sql` in the Supabase SQL editor. It creates
`projects`, `conversations`, `messages`, and **`videos`**, plus the public `project-assets`
storage bucket and RLS policies.

Already ran an older copy? The `videos` table and its policies are the only new part —
re-running the whole file is safe (everything is `IF NOT EXISTS` / `DROP … IF EXISTS`).

## 3. Backend

```bash
cd backend
cp .env.example .env
# fill in: VIDEO_DB_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

Verify: http://localhost:8000/health → `{"status":"ok","videodb":"ok","supabase":"ok"}`.
API docs: http://localhost:8000/docs

`SUPABASE_SERVICE_ROLE_KEY` is the same value as `NEXT_PUBLIC_SUPABASE_ADMIN` in
`frontend/.env.local`, if that is what you have there.

## 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on http://localhost:3000. It talks to the backend at `VIDEODB_BACKEND_URL`, which
defaults to `http://localhost:8000` — only set it if you changed the port.

Both servers need to be running: the frontend alone cannot ingest or retrieve.

---

## Using it

1. **Create a project** at `/projects` → "New Project". You land on the project workspace.
2. **Upload videos** — "Upload file" (top right). Drag files in, or paste direct/YouTube URLs
   under "Or add file URLs". Files go to Supabase Storage; their public URL is what VideoDB
   ingests.
3. **Wait for indexing.** Each card shows a status pill: `Uploading` → `Indexing` → `Ready`.
   The grid polls every 5 s. Indexing is genuinely slow — several minutes for a short clip,
   longer for a full-length video. Only `Ready` videos are searchable.
4. **Ask something** in the prompt box (or click a suggestion card). This creates a chat with
   every ready video pre-tagged.
5. **In the chat**, use the **Videos** button next to the model selector to tag exactly which
   videos to search. Tagged videos show as chips above the input.

### What to ask

| You say | The agent calls |
|---|---|
| "What is this video about?" / "Summarize it" | `ask_video` — answer + source moments |
| "Find the moment where they discuss X" | `search_video_moments` — timestamped moments |
| "Show me clips of X" / "Make a highlight reel" | retrieval + `show_clips` → **artifact panel** |
| "What exactly did they say at 2:30?" | `get_video_transcript` |
| "How many scenes are outdoors?" | `aggregate_video_index` |
| "Every scene tagged as a conversation" | `query_video_index` |

Clips open in the right-hand **artifact panel**: a player on top, the clip list below.
Click any row to play that moment; "Play all" plays them back to back. The chat message
stays short and cites `m:ss` timestamps.

### Troubleshooting

| Symptom | Cause |
|---|---|
| "Cannot reach the video backend" | The FastAPI server isn't running on port 8000 |
| Upload fails on a big file | Supabase caps uploads at 50 MB by default — raise the bucket limit, or add the video by URL instead |
| Video stuck on `Indexing` | Normal for long videos. Check the backend logs; `Failed` cards offer **Re-index** from the card menu |
| Agent says a video isn't searchable | Its status isn't `Ready` yet — that is the intended behaviour, not a bug |
| `/health` shows `videodb: error` | `VIDEO_DB_API_KEY` missing or wrong in `backend/.env` |

Cost/quality knobs (scene segmentation, VLM tier, frame count, resolution) live in
`backend/.env` — see `backend/README.md`.
