# CLAUDE.md

Context for picking this project up cold. Read alongside `README.md`
(what it is) and `docs/ENDPOINTS.md` (the API surface).

## What this is

A video RAG system: chunk a video, run analyzers per chunk, aggregate to
video level, index everything, then search it or ask questions of it. Served
by FastAPI with a web UI, and designed so an LLM agent can drive it.

## Environment — do not "fix" these

- **Python 3.13.6, torch 2.11.0+cu130, RTX 4060 (8 GB).** This combination
  works; it is newer than most guides assume. Do not downgrade to "known good"
  versions without a measured reason.
- **`USE_TF=0` is set in `videomind/__init__.py`**, before anything imports
  transformers. Without it transformers imports TensorFlow, costing seconds of
  startup and a wall of oneDNN/absl banners, for a backend nothing here uses.
  It is in the package root because `uvicorn videomind.api.app:app` imports the
  package before any submodule.
- **The torchcodec warning is filtered, not fixed.** pyannote warns that it
  cannot load torchcodec's FFmpeg DLLs. Audio is decoded with PyAV and handed
  to pyannote in memory, so torchcodec is never used. The filter needs `(?s)`
  because that warning's text starts with a newline and `filterwarnings`
  anchors with `re.match`.
- **Windows: `pkill` does not kill Python.** A server that fails to bind exits
  quietly, so you keep hitting the *old* process and appear to be running stale
  code. Free the port with the PowerShell snippet in `docs/COMMANDS.md`. This
  has wasted time more than once.
- **PaddleOCR was tried and removed.** It broke `cv2`, forced a torch import
  order, had no GPU build for CUDA 13, and needed `enable_mkldnn=False` to run
  at all. EasyOCR replaced it. Do not reintroduce Paddle.

## Architecture

```
chunk_video()            three modes: preset | weights | interval
  boundaries/            speaker, silence, cut, semantic detectors
  chunking/chunker.py    weighted fusion -> boundaries -> chunks
analyzers/               per-chunk passes,  registry in __init__.py
aggregators/             video-level passes, registry in __init__.py
vectordb/                BGE embeddings + Qdrant (named vectors)
api/core.py              upload / query / ask / aggregate  (real logic)
api/app.py               thin HTTP layer
api/ui.py                web UI, mounted only when VIDEOMIND_UI != 0
paths.py                 every path, all env-overridable
```

**Adding an analyzer**: one module with `id`, `analyze(chunks, ctx)`,
`render_fields(output)`, plus a line in `analyzers/__init__.py`. Nothing in
ingest, the store, or the API changes.

**Adding an aggregator**: one module with `id`, `depends_on`,
`aggregate(ctx)`, plus a line in `aggregators/__init__.py`. Order is derived
from `depends_on`; an aggregator whose analyzer is absent is skipped, not
failed.

**Composition is in-process.** HTTP is the external boundary (UI, MCP);
aggregators call analyzer output directly. Do not have the service call itself
over HTTP.

## Decisions that look odd but are deliberate

- **Weights renormalise over signals that fired.** Otherwise the preset acts as
  a granularity dial: on single-signal footage `audio` and `video` produced 12
  vs 63 boundaries from identical content.
- **Frame sampling uses an adaptive threshold with an absolute ceiling.** A
  fixed 0.95 kept one frame on a static camera (consecutive similarity median
  0.9955); a purely relative threshold mined "distinct" frames out of
  compression noise. Both were measured.
- **Frame reading uses `grab()`/`retrieve()`, never per-frame seeking.**
  Seeking makes H.264 restart from a keyframe — measured ~22x more expensive
  per frame.
- **OCR sends 1600px `detail="high"` images**, unlike every other analyzer. At
  768px small or low-contrast text is illegible and silently missed.
- **Detector labels are never shown to the VLM.** YOLO called a thermal tank an
  "airplane" (0.73); with unlabelled boxes the VLM said "tank".
- **Entity linking clusters embeddings under constraints, and only then calls
  an LLM** to write narratives. Asked to match people directly, an LLM
  confidently merges anyone in dark clothing. Constraints: people co-visible in
  one chunk cannot be the same person; descriptions too generic to identify
  anyone are left unlinked.
- **Object linking reuses the same clusterer** (`link_observations` in
  `aggregators/entities.py`), with two filters people do not need: static
  fixtures (counters, shelves) are counted but not tracked, because "the
  counter was present throughout" is true of every frame and tells a search
  nothing; and person-like detections are handed to the people aggregator,
  which has clothing to identify them with.
- **Entity signature is `clothing` only.** Blending in `appearance` dragged
  same-person scores to 0.69–0.87 because it drifts and sometimes contains
  meta-commentary ("same woman as box 3") that the embedding treats as content.
- **`transcript` and `diarization` are mutually exclusive.** Their vectors came
  out cosine-identical (1.0000); diarization is a strict superset.
- **`detail` on `/query`.** Five full hits measured ~19k tokens versus ~440 at
  `minimal`. The UI wants everything, an agent pays per token.
- **`filters` is a generic dict validated against `FILTER_SPEC`.** The previous
  hand-plumbed parameter list left six store filters silently unreachable.

## Known limitations

- **Cross-video entity linking is not built.** Deferred: the available media
  shares no people, so it could not be tested.
- **Within-chunk person tracking fragments.** IoU tracking at 1 fps loses
  people who move between sampled frames. `box_id` is a referent within a
  chunk, *not* an identity claim.
- **Qdrant payload indexes are inert in embedded mode.** Filtering is correct
  but scans. Fixed by running Qdrant as a server; no code change needed.
- **Jobs live in memory.** A restart loses job history; vectors and records
  survive on disk.
- **Chapters can return a single chapter** on unbroken single-location footage.
  Arguably correct, but useless in the UI.
- **Whisper hallucinates on non-speech audio** — `vad_filter=True` handles it.
  Language is detected once per video and pinned, because per-segment detection
  produced fluent German from an English clip.

## Testing notes

- `media/test.mp4` — 5 min supermarket CCTV, 1280x720. The video-analyzer
  fixture. No speech.
- `media/speech_test.mp4` — 60 s multi-speaker audio over a placeholder video.
  The only asset where `speaker`, `silence` and `diarization` all fire; use it
  for audio analyzers and aggregators.
- Verify against a **live server**, not by reading code. Several bugs here
  (broken synthesis, stale ports, wrong media paths) only appeared over HTTP.
- Aggregators are cached. Pass `force=true` when testing a change to one, or
  you will be reading yesterday's output.

## Current state

Working end to end: 6 analyzers, 12 aggregators, chunking in three modes,
search with filters and detail levels, question answering with routing, and a
four-tab UI (Search/Ask, Insights, Details, Upload) with progress bars.

Natural next steps: cross-video entity linking once suitable media exists; an
MCP server over the read endpoints plus `/query` and `/ask`; visual re-ID using
the stored `locations` for entity pairs text cannot resolve.
