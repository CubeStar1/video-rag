# VideoMind

Video RAG. Splits a video into meaningful chunks, runs analyzers over them,
rolls those up into video-level insight, and makes the whole thing searchable
and answerable — through a web UI, an HTTP API, or an LLM agent.

```
video ─▶ chunk ─▶ analyze ─▶ index ─▶ aggregate ─▶ search / ask
```

## Quick start

```bash
pip install torch==2.11.0 torchvision==0.26.0 torchaudio==2.11.0 \
    --index-url https://download.pytorch.org/whl/cu130
pip install -r requirements.txt

echo "OPENAI_API_KEY=sk-..."            >  .env
echo "HF_TOKEN=hf_..."                  >> .env      # diarization only
echo "SUPABASE_URL=https://xxx.supabase.co"   >> .env
echo "SUPABASE_SERVICE_ROLE_KEY=eyJ..."       >> .env

python serve.py               # http://127.0.0.1:8077
```

`HF_TOKEN` is only needed for the `diarization` analyzer, and its model is
gated — accept the terms at
<https://huggingface.co/pyannote/speaker-diarization-community-1> first.

Video bytes live in a public Supabase Storage bucket named `videos`, created
once per project:

```python
from supabase import create_client
create_client(URL, SERVICE_ROLE_KEY).storage.create_bucket("videos", options={"public": True})
```

Check it is wired up with `GET /health` — `storage.ok` is false, and `status`
`degraded`, when the key is wrong or the bucket is missing.

Upload a video in the **Upload** tab — a file or a URL — then use **Search**,
**Ask**, **Insights** and **Details**.

| Variable | Default | For |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | – | Storage. Required; ingest cannot run without them |
| `VIDEOMIND_BUCKET` | `videos` | Bucket name |
| `VIDEOMIND_MAX_BYTES` | 4 GiB | Cap on a server-side fetch of a caller-supplied URL |
| `VIDEOMIND_CACHE` | `data/cache` | Local copies of videos, keyed by content hash |

## How it works

**Chunking** finds boundaries from four signals — speaker changes (pyannote),
silence (Silero VAD), hard cuts (PySceneDetect) and semantic drift (CLIP) —
fused with per-preset weights. Not every video offers every signal; unbroken
CCTV has no cuts, silent footage no speaker turns. Weights are renormalised
over the signals that actually fired, so a preset expresses *which signals
matter* rather than doubling as a granularity dial. You can also supply your
own weights, or cut at a fixed interval.

**Analyzers** run per chunk. Each owns its own frame sampling, prompt and
output shape, so a new one needs no changes anywhere else.

| analyzer | needs | produces |
|---|---|---|
| `default_video` | frames | scene description, setting, people, objects, actions, tags |
| `people` | frames | per-person appearance, role, action, box locations |
| `object_detection` | frames | objects with appearance and purpose |
| `ocr` | frames | on-screen text with context |
| `transcript` | audio | speech text |
| `diarization` | audio | speaker-attributed transcript |

`ocr` and `object_detection` use cheap detectors (EasyOCR, YOLO) purely as
*gates* — frames with nothing to read or see never reach a VLM. Detector
labels are never shown to the VLM, because YOLO confidently called a
thermal-imaged tank an "airplane" and a label written onto the image invites
agreement with it.

**Aggregators** run after analyzers, over their saved output rather than the
video, so re-running one costs no re-analysis. Results are cached and only
recomputed on demand or when the analyzer set changes.

`stats` · `novelty` · `speaker_stats` · `summary` · `chapters` · `events` ·
`ner` · `sentiment` · `entities` · `object_entities` · `entity_timelines` ·
`cooccurrence`

**Retrieval** stores one point per chunk in Qdrant with several named vectors
(`combined`, `description`, `people`, `actions`, `objects`), so a query about
appearance can match a short person description rather than compete with a
whole record.

**Ask** answers questions rather than returning segments, routing each question
to the aggregates that can address it — a question about one person reaches the
entity narratives, "what is unusual" reaches novelty.

## Layout

```
serve.py            entry point
videomind/
  paths.py          every path, overridable by environment variable
  chunk.py          chunking modes
  chunking/         boundary fusion
  boundaries/       the four signal detectors
  analyzers/        per-chunk passes  (add one here)
  aggregators/      video-level passes (add one here)
  extractors/       shared primitives: frames, audio, VLM, detectors
  vectordb/         embedding + Qdrant store
  api/              core logic, HTTP routes, jobs, web UI
docs/               COMMANDS.md, ENDPOINTS.md
scripts/            reindex.py, bench.py
media/              test assets
data/               all runtime state (gitignored)
```

## Docs

- [docs/COMMANDS.md](docs/COMMANDS.md) — running, resetting, inspecting
- [docs/ENDPOINTS.md](docs/ENDPOINTS.md) — full API reference
- [CLAUDE.md](CLAUDE.md) — design decisions and known limitations

## Requirements

Python 3.13, a CUDA GPU (developed on an RTX 4060, 8 GB), and an OpenAI API
key. Everything except the VLM calls and answer synthesis runs locally.
