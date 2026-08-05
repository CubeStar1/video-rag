# Commands

## Run the server

```bash
python serve.py                # API + web UI
python serve.py --api-only     # API only, no UI
```

Opens on <http://127.0.0.1:8077>. `/docs` has interactive API docs either way;
`/health` reports which mode is running and what is loaded.

```bash
python serve.py --port 9000        # different port
python serve.py --reload           # auto-restart on code changes
python serve.py --host 0.0.0.0     # reachable from other machines on the LAN
```

Use `--api-only` when the UI is not wanted — behind another frontend, or for an
MCP client that has no use for HTML. It drops the `/` route and nothing else.

Equivalent, invoking uvicorn directly:

```bash
python -m uvicorn videomind.api.app:app --port 8077
VIDEOMIND_UI=0 python -m uvicorn videomind.api.app:app --port 8077   # API only
```

`--api-only` sets `VIDEOMIND_UI=0`; the variable exists because uvicorn's import
string gives no way to pass an argument to the app.

Both are quiet: `USE_TF=0` is set before anything imports `transformers`, which
otherwise pulls in TensorFlow (nothing here uses it) along with several seconds
of startup and a wall of oneDNN/absl banners.

### Port already in use

`pkill` does not reliably kill Python on Windows. Free the port with PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 8077 -State Listen |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force }
```

A server that fails to bind exits quietly, so requests keep hitting the *old*
process and you appear to be running stale code. Check the port first when
changes seem not to apply.

## Clear the database

Everything the app writes lives under `data/`, so a full reset is one command:

```bash
rm -rf data
```

```powershell
Remove-Item -Recurse -Force data
```

Recreated automatically on the next upload. That removes the vector store,
every video's record — including its summaries, chapters, entities and stats,
which live in the record alongside the per-chunk output — the uploaded videos,
and downloaded model weights. `media/` is untouched.

To keep uploads and model weights and clear only the index:

```bash
rm -rf data/vectordb data/records
```

Paths are overridable, so a second instance can use its own data:

```bash
VIDEOMIND_DATA=/tmp/vm-test python serve.py --port 8078
```

### Clear one video instead of everything

```python
from videomind.vectordb import ChunkStore
cs = ChunkStore()
cs.delete_video("95e110e25070fcfc")                        # every chunking
cs.delete_video("95e110e25070fcfc", chunk_config="interval:10")  # just one
cs.close()
```

Re-uploading the same file with the same chunking already replaces its vectors,
so this is only needed to remove a video outright.

## Inspect what was produced

Each upload writes `data/records/<name>__<id8>.json` with every analyzer's output per
chunk, including `_frames` (the timestamps the sampler chose). Useful for
checking why a description says what it does.

```bash
ls data/records/
python -c "import json,glob; d=json.load(open(glob.glob('data/records/*.json')[0])); print(json.dumps(d['chunks'][0], indent=2))"
```

Vector store contents:

```python
from videomind.vectordb import ChunkStore
from videomind.vectordb.store import COLLECTION
cs = ChunkStore()
print(cs.count())
pts, _ = cs.client.scroll(COLLECTION, limit=100, with_payload=True)
for p in pts[:5]:
    print(p.payload["video_id"], p.payload["extractor_id"], p.payload["start"], p.payload["end"])
cs.close()
```

## Re-run aggregators without re-analysing

Aggregators (summary, chapters, events, stats, novelty, entities, NER,
sentiment, speaker stats, co-occurrence) read `data/records/` rather than the video,
so re-running them costs no re-analysis. They run automatically at the end of an
upload; this is for re-running after tuning one.

In the UI: **Insights → Re-run**. Over HTTP:

```bash
curl -X POST http://127.0.0.1:8077/videos/<video_id>/aggregates          # all of them
curl -X POST http://127.0.0.1:8077/videos/<video_id>/aggregates \
     -F "aggregators=summary,chapters"                                    # just these
```

Both return a `job_id` to poll at `/jobs/{job_id}`.

Only `summary`, `chapters`, `events` and `entities` make API calls — the rest
are local. `GET /schema` reports which is which under `aggregators[*].uses_llm`.

An aggregator whose analyzer is missing is skipped, not failed: the entity chain
needs `people`, and `sentiment`/`speaker_stats` need `diarization`. The job
result lists `ran`, `skipped` and `failed` separately.

## Rebuild vectors without re-running analyzers

Re-embeds from saved records — no OpenAI calls, so it costs nothing. Use after
changing the embedding model or the render logic. Aggregates in the record are
left untouched.

Results already stored are reused unless you force them, so re-running costs no
API calls for `summary`, `chapters`, `events` or `entities`:

```bash
curl -X POST 'http://127.0.0.1:8077/videos/<video_id>/aggregates?force=false'
```

```bash
python scripts/reindex.py
```
