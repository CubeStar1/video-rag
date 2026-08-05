# FalconVQA — Architecture Diagram Spec

Prompt-ready description of the system architecture, written for an image-generation API.
Style follows the reference architecture poster: colored tabbed group boxes, pale bullet
panels, logo chips, numbered arrows.

---

## A. Text budget (most important rule)

The diagram fails if it is dense. Enforce, strictly:

- **Max 5 bullets per box.** Never 6.
- **Max 6 words per bullet.** No sub-clauses, no parentheticals, no full sentences.
- **No file paths, no route paths, no version numbers inside any box.** Versions live only
  in the tech-stack logo chips.
- **Box titles: 2–4 words.** Sub-caption chips: 4 words max.
- Body text must render at a size a person reads without zooming — roughly 1/3 the height
  of the box title. If bullets do not fit at that size, **cut bullets, do not shrink type**.
- Generous padding: ~20px inside every box, ~30px between boxes. Whitespace is the point.

---

## B. Global style

Landscape architecture poster, ~1600×1100, white canvas, thin blue rule along the top.
Every component is a **rounded rectangle with a 2–3px colored border and a pale tinted fill**.
Each group carries a **small colored tab label on its top-left corner**, like a folder tab.
Inside a group: an optional dark UI mockup or logo row, then a **pale bullet panel**.
Tech appears as **white chips with vendor logos** in a green-bordered "Tech Stack" strip.
Arrows are thick colored curves, each with a **numbered circle badge** and a 3–5 word label.
Bold sans-serif headers, clean small body text.

Colors:

- **Orange** = Frontend and Agent
- **Red/pink** = Core Backend service
- **Green** = Data & Storage
- **Blue** = Deployment
- **Purple headers on a green band** = the 4-phase pipeline across the bottom

---

## C. Components

### 1. Client App (top-left, orange tab)

Dark dashboard mockup: project sidebar, center chat thread, right artifact panel with a
video player over a clip list.

Bullets:

- Project workspace and video grid
- Streaming agent chat
- Clip reel artifact panel
- Timeline and segment studio
- Auth-guarded routes

**Tech Stack — Frontend** (logo chips): Next.js · React · TypeScript · Tailwind ·
AI SDK · video.js

---

### 2. AI Agent (below Client App, orange tab)

Bullets:

- Streaming multi-step tool loop
- Nine retrieval and clip tools
- Video context in system prompt
- Multi-provider model registry
- Conversations persisted per turn

Small chip row: OpenAI · Google · Groq · Cerebras · xAI

---

### 3. FalconVQA Service (center-right, red tab)

Row of blue capability chips: `Ingest` · `Analyzers` · `Aggregators` · `Vector Search` ·
`Ask` · `Jobs`

Bullets:

- Async ingest with staged progress
- Registry-driven analyzers and aggregators
- Self-describing schema endpoint
- Vector search with typed filters
- Routed question answering

**Tech Stack — Core** (logo chips): FastAPI · Python · PyTorch · Qdrant · YOLO ·
OpenAI · OpenCV

---

### 4. Data & Storage (top-right, green tab) — four small stacked cards

Each card is a title plus **one** line, not a bullet list.

- **Supabase Storage** — video bytes, hash-keyed
- **Supabase Postgres** — projects, chats, video registry
- **Qdrant** — chunk vectors, five named fields
- **Local cache** — records, frames, model weights

---

### 5. Deployment (far right, blue tab) — logo chips only, no bullets

Vercel · GPU Host · Supabase Cloud · Qdrant

---

## D. Processing Pipeline — full-width band across the bottom (green group, purple card headers)

Five cards left→right, joined by thick arrows. Each card: purple header bar, one grey
sub-caption chip, then **at most 5 short bullets**.

### Phase 1 — Ingestion

Sub-caption: `Source to chunks`

- Upload file or URL
- Hash, store, cache locally
- Four boundary signals detected
- Weighted fusion picks cuts
- Preset, custom, or interval modes

### Phase 2 — Analysis

Sub-caption: `Six per-chunk analyzers`

- Scene description and tags
- Per-person appearance and action
- Object detection gates the VLM
- On-screen text extraction
- Transcript with speaker attribution

### Phase 3 — Indexing

Sub-caption: `Embed and roll up`

- Local embedding model
- Five named vectors per chunk
- Typed payload filters
- Twelve video-level aggregators
- Cached, dependency-ordered runs

### Phase 4 — Querying

Sub-caption: `Search and ask`

- Vector search with filters
- Three response detail levels
- Questions routed to aggregates
- Answers synthesized with citations
- Jobs and schema introspection

### Phase 5 — Outputs

Sub-caption: `What the client gets`

- Cited answers with timecodes
- Ranked moments and clips
- Chapters and event timeline
- Entity timelines and co-occurrence
- Stats, novelty, sentiment

---

## E. Connections (numbered badges, 3–5 word labels)

Keep only these ten. Do not label the pipeline's internal arrows — they are self-evident.

| # | From → To | Label |
|---|---|---|
| 1 | Client App → Supabase Storage | Upload video file |
| 2 | Client App → FalconVQA Service | Submit for ingestion |
| 3 | FalconVQA Service → Phase 1 | Start ingest job |
| 4 | Phase 1 → 2 → 3 → 4 → 5 | *(unlabeled)* |
| 5 | Phase 3 → Data & Storage | Write vectors and records |
| 6 | FalconVQA Service → Client App | Poll job progress |
| 7 | Client App → AI Agent | Question and tagged videos |
| 8 | AI Agent → FalconVQA Service | Search and ask calls |
| 9 | FalconVQA Service → Client App | Answers, moments, clips |
| 10 | AI Agent → Supabase Postgres | Persist conversation |
