import hashlib
import json
import re
from pathlib import Path
from typing import Any, Callable

from .. import aggregators, analyzers, store
from ..chunk import chunk_video
from ..paths import RECORDS_DIR, UPLOAD_DIR, ensure as ensure_dirs
from ..vectordb import ChunkStore, config_key


def video_id_for(video_path: str) -> str:
    """Content-derived id.

    Not the filename stem: two different uploads both called `test.mp4` would
    otherwise merge into one video's vectors.
    """
    digest = hashlib.sha1()
    with open(video_path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()[:16]


def upload(
    video_path: str,
    analyzer_ids: list[str] | None = None,
    preset: str | None = "audio_video",
    weights: dict[str, float] | None = None,
    interval: float | None = None,
    min_duration: float = 5.0,
    max_duration: float = 20.0,
    aggregate: bool = True,
    chunk_store: ChunkStore | None = None,
    progress: Callable[[str, dict], None] | None = None,
) -> dict:
    """Chunk a video, run the chosen analyzers, and index the results.

    Chunking is one of three modes - `interval`, `weights`, or `preset` - see
    chunk_video. Analyzers are chosen per upload because they differ wildly in
    cost: the scene analyzer bills per chunk, transcription is free.
    """
    analyzer_ids = analyzer_ids or ["default_video"]
    analyzers.validate_selection(analyzer_ids)  # fail fast before doing any work

    video_id = video_id_for(video_path)
    cfg = config_key(preset, min_duration, max_duration, weights=weights, interval=interval)

    def report(stage, **info):
        if progress:
            progress(stage, info)

    report("chunking")
    chunks = chunk_video(
        video_path,
        preset=preset,
        min_duration=min_duration,
        max_duration=max_duration,
        weights=weights,
        interval=interval,
    )
    report("chunked", chunks=len(chunks))

    ctx = analyzers.VideoContext(video_path)
    cs = chunk_store or ChunkStore()
    owns_store = chunk_store is None

    # Reuse the existing record when re-running against the same chunking, so
    # analyzers run earlier keep their output instead of being overwritten by
    # whichever set this upload happened to request.
    existing_path = record_path_for(video_id)
    existing = json.loads(existing_path.read_text(encoding="utf-8")) if existing_path else None
    if existing and existing.get("chunk_config") == cfg:
        record = existing
        record["analyzers"] = sorted(set(record.get("analyzers", [])) | set(analyzer_ids))
    else:
        record = store.build(
            video_path, chunks, preset=preset,
            min_duration=min_duration, max_duration=max_duration,
        )
        record["analyzers"] = list(analyzer_ids)
        # Chunk boundaries changed, so the old chunking's vectors no longer
        # describe anything that exists - drop all of them for this video.
        if existing:
            cs.delete_video(video_id)
    record["video_id"] = video_id
    record["chunk_config"] = cfg

    indexed = {}
    try:
        for analyzer_id in analyzer_ids:
            analyzer = analyzers.get(analyzer_id)
            report("analyzing", analyzer=analyzer_id)
            # Scoped to this analyzer: a broader delete would take out every
            # other analyzer's vectors for the same video.
            cs.delete_video(video_id, chunk_config=cfg, extractor_id=analyzer_id)
            outputs = analyzer.analyze(chunks, ctx)

            payload = []
            for i, ((start, end), output) in enumerate(zip(chunks, outputs)):
                if output is None:
                    continue
                store.attach(record, i, **{analyzer_id: output})
                payload.append(
                    {
                        "id": i,
                        "start": start,
                        "end": end,
                        "output": output,
                        "fields": analyzer.render_fields(output),
                    }
                )

            report("indexing", analyzer=analyzer_id)
            indexed[analyzer_id] = cs.add_chunks(video_id, video_path, payload, analyzer_id, cfg)
    finally:
        if owns_store:
            cs.close()

    # Named for readability - a bare content hash is useless when you are
    # grepping records to see what an upload produced. The id stays in the
    # filename so two videos with the same name cannot collide.
    ensure_dirs()
    stem = re.sub(r"[^A-Za-z0-9_-]+", "_", Path(video_path).stem)[:48].strip("_")
    for stale in RECORDS_DIR.glob(f"*__{video_id[:8]}.json"):
        stale.unlink()
    store.save(record, str(RECORDS_DIR / f"{stem}__{video_id[:8]}.json"))

    result = {
        "video_id": video_id,
        "video_path": video_path,
        "chunk_config": cfg,
        "chunks": len(chunks),
        "indexed": indexed,
    }

    # Aggregators read the record just written, so they run as a final stage
    # rather than needing the video again.
    if aggregate:
        try:
            result["aggregated"] = run_aggregators(video_id, progress=progress)
        except Exception as exc:
            result["aggregated"] = {"error": f"{type(exc).__name__}: {exc}"}

    return result


def list_videos() -> list[dict]:
    """Videos that have been ingested, from their saved records."""
    out = []
    for path in sorted(RECORDS_DIR.glob("*.json")) if RECORDS_DIR.exists() else []:
        record = json.loads(path.read_text(encoding="utf-8"))
        out.append(
            {
                "video_id": record.get("video_id", path.stem),
                "video": record.get("video"),
                "chunks": len(record.get("chunks", [])),
                "chunk_config": record.get("chunk_config"),
                "analyzers": record.get("analyzers", []),
            }
        )
    return out


def record_path_for(video_id: str) -> Path | None:
    """Find a video's record. Records are named for readability, so this
    matches on the `video_id` inside rather than on the filename."""
    if not RECORDS_DIR.exists():
        return None
    for path in RECORDS_DIR.glob("*.json"):
        try:
            if json.loads(path.read_text(encoding="utf-8")).get("video_id") == video_id:
                return path
        except (json.JSONDecodeError, OSError):
            continue
    return None


def video_path_for(video_id: str) -> str | None:
    """Resolve an ingested video's file path from its saved record.

    Records store the path used at upload time, which stops resolving if the
    data directory is moved or the app is run from elsewhere. The filename is
    the stable part, so fall back to looking it up in the current upload
    directory rather than reporting the video as missing.
    """
    path = record_path_for(video_id)
    if path is None:
        return None
    stored = json.loads(path.read_text(encoding="utf-8")).get("video")
    if not stored:
        return None
    if Path(stored).exists():
        return stored
    relocated = UPLOAD_DIR / Path(stored.replace("\\", "/")).name
    return str(relocated) if relocated.exists() else stored


def _timecode(seconds: float) -> str:
    return f"{int(seconds // 60)}:{seconds % 60:05.2f}"


# Bulky or internal keys, dropped unless explicitly asked for. `locations` is
# per-frame box geometry that only the entity-linking pass needs, and an LLM
# reading chunk output gains nothing from a wall of pixel coordinates.
_INTERNAL_KEYS = ("locations",)


def _strip(value, verbose: bool):
    """Remove debug and geometry keys from an analyzer's output."""
    if verbose or not isinstance(value, dict):
        return value
    cleaned = {
        k: v for k, v in value.items()
        if not k.startswith("_") and k not in _INTERNAL_KEYS
    }
    for key, inner in cleaned.items():
        if isinstance(inner, list):
            cleaned[key] = [_strip(item, verbose) for item in inner]
    return cleaned


DETAIL_LEVELS = ("minimal", "standard", "full")
SNIPPET_CHARS = 180


def _shape(hit: dict, detail: str) -> dict:
    """Trim a search hit to the caller's appetite.

    The same result serves a browser and an agent, and they want opposite
    things. A page can render every nested record cheaply; an agent pays for
    each one in context, where five full hits ran to ~19k tokens against ~80
    for their identifiers. So detail is chosen per call rather than baked in.
    """
    base = {
        "video_id": hit["video_id"],
        "chunk_id": hit["chunk_id"],
        "start": hit["start"],
        "end": hit["end"],
        "timecode": f"{_timecode(hit['start'])}-{_timecode(hit['end'])}",
        "score": round(hit["score"], 4),
    }
    if detail == "minimal":
        # Enough to decide what is worth fetching in full, and nothing more.
        text = (hit.get("description") or hit.get("text") or "").strip()
        base["snippet"] = text[:SNIPPET_CHARS] + ("..." if len(text) > SNIPPET_CHARS else "")
        return base

    base.update({
        "video_path": hit["video_path"],
        # `text` is the whole flattened record that was embedded - the UI
        # renders `description`, so carrying both doubles the response for
        # nothing. It returns at detail="full".
        "description": hit.get("description", ""),
        "people": hit.get("people", []),
        "objects": hit.get("objects", []),
        "actions": hit.get("actions", []),
        "tags": hit.get("tags", []),
        "speakers": hit.get("speakers", []),
        "people_count": hit.get("people_count"),
        "turns": hit.get("turns", []),
    })
    if detail == "full":
        # The heavy nested records: every person's full description, every
        # detected object, every read string. Nothing renders these in the UI.
        base.update({
            "text": hit["text"],
            "persons": hit.get("persons", []),
            "detections": hit.get("detections", []),
            "texts": hit.get("texts", []),
        })
    return base


def run_aggregators(
    video_id: str,
    aggregator_ids: list[str] | None = None,
    force: bool = False,
    chunk_store: ChunkStore | None = None,
    progress: Callable[[str, dict], None] | None = None,
) -> dict:
    """Run video-level passes over a video's stored analyzer output.

    Separate from ingestion on purpose: aggregators read `records/`, not the
    video, so re-summarising or re-linking after tuning costs no re-analysis.

    Results already stored are reused unless `force`. Four of these bill an
    API call per run, so re-uploading a video to add one analyzer would
    otherwise re-buy its summary, chapters, events and entities every time.
    """
    path = record_path_for(video_id)
    if path is None:
        raise ValueError(f"No such video {video_id!r}")
    record = json.loads(path.read_text(encoding="utf-8"))

    analyzers_now = sorted(record.get("analyzers", []))
    requested = aggregator_ids or aggregators.available()
    order = aggregators.resolve_order(requested, analyzers_now)
    skipped = sorted(set(requested) - set(order))

    # Aggregates summarise whatever analyzers existed when they ran. Adding an
    # analyzer later makes them stale - a summary written before `people` ran
    # describes a video it could not see people in - so the whole set is
    # recomputed rather than serving a confidently outdated answer.
    stale = record.get("aggregates_analyzers") != analyzers_now
    force = force or stale

    cs = chunk_store or ChunkStore()
    owns_store = chunk_store is None
    ctx = aggregators.AggregateContext(
        record=record, video_path=record["video"], store=cs,
        results=dict(record.get("aggregates", {})),
    )

    produced, failed, reused = {}, {}, []
    try:
        for aggregator_id in order:
            if not force and aggregator_id in ctx.results:
                reused.append(aggregator_id)
                continue
            if progress:
                progress("aggregating", {"aggregator": aggregator_id})
            try:
                result = aggregators.get(aggregator_id).aggregate(ctx)
            except Exception as exc:
                # One aggregator failing must not lose the others' work.
                failed[aggregator_id] = f"{type(exc).__name__}: {exc}"
                continue
            if result is not None:
                ctx.results[aggregator_id] = result
                produced[aggregator_id] = result
    finally:
        if owns_store:
            cs.close()

    record["aggregates"] = ctx.results
    record["aggregates_analyzers"] = analyzers_now
    store.save(record, str(path))

    return {
        "video_id": video_id,
        "ran": list(produced),
        "reused": reused,            # already stored; pass force=True to recompute
        "skipped": skipped,          # dependencies this video cannot satisfy
        "failed": failed,
        "aggregates": list(ctx.results),
        "recomputed_because_analyzers_changed": stale,
        "llm_calls_saved": [a for a in reused if a in aggregators.USES_LLM],
    }


def get_aggregates(video_id: str, aggregator_id: str | None = None) -> dict | None:
    """Stored aggregator output for a video."""
    path = record_path_for(video_id)
    if path is None:
        return None
    record = json.loads(path.read_text(encoding="utf-8"))
    stored = record.get("aggregates", {})
    if aggregator_id:
        if aggregator_id not in stored:
            raise ValueError(
                f"Video has no {aggregator_id!r} aggregate; it has {sorted(stored)}"
            )
        return {"video_id": video_id, "aggregator": aggregator_id, "result": stored[aggregator_id]}
    return {"video_id": video_id, "available": sorted(stored), "aggregates": stored}


def get_video(video_id: str) -> dict | None:
    """Metadata for one ingested video."""
    path = record_path_for(video_id)
    if path is None:
        return None
    record = json.loads(path.read_text(encoding="utf-8"))
    chunks = record.get("chunks", [])
    return {
        "video_id": record.get("video_id"),
        "video": record.get("video"),
        "preset": record.get("preset"),
        "params": record.get("params", {}),
        "chunk_config": record.get("chunk_config"),
        "analyzers": record.get("analyzers", []),
        "chunks": len(chunks),
        "duration": round(chunks[-1]["end"], 2) if chunks else 0.0,
    }


def get_chunks(
    video_id: str,
    analyzer_id: str | None = None,
    after: float | None = None,
    before: float | None = None,
    chunk_ids: list[int] | None = None,
    limit: int = 50,
    offset: int = 0,
    verbose: bool = False,
) -> dict | None:
    """Stored analyzer output for a video's chunks, scoped and paginated.

    This is the read side an agent or the UI uses to look at what was produced,
    as opposed to searching for it. Always bounded so a caller cannot pull a
    whole video's output into context by accident.
    """
    path = record_path_for(video_id)
    if path is None:
        return None
    record = json.loads(path.read_text(encoding="utf-8"))
    available = record.get("analyzers", [])
    if analyzer_id and analyzer_id not in available:
        raise ValueError(f"Video has no {analyzer_id!r} output; it has {available}")

    # Batch fetch: an agent holding chunk ids from a search gets them all in
    # one call instead of one round trip each.
    wanted_ids = set(chunk_ids) if chunk_ids else None

    selected = []
    for chunk in record.get("chunks", []):
        if wanted_ids is not None and chunk["id"] not in wanted_ids:
            continue
        if after is not None and chunk["end"] <= after:
            continue
        if before is not None and chunk["start"] >= before:
            continue
        wanted = [analyzer_id] if analyzer_id else available
        outputs = {a: _strip(chunk[a], verbose) for a in wanted if chunk.get(a)}
        if analyzer_id and not outputs:
            continue  # nothing from that analyzer for this chunk
        selected.append({
            "chunk_id": chunk["id"],
            "start": chunk["start"],
            "end": chunk["end"],
            "timecode": f"{_timecode(chunk['start'])}-{_timecode(chunk['end'])}",
            **outputs,
        })

    return {
        "video_id": video_id,
        "analyzers": available,
        "total": len(selected),
        "offset": offset,
        "limit": limit,
        "chunks": selected[offset : offset + limit],
    }


def get_chunk(video_id: str, chunk_id: int, verbose: bool = False) -> dict | None:
    """Everything every analyzer produced for one chunk."""
    path = record_path_for(video_id)
    if path is None:
        return None
    record = json.loads(path.read_text(encoding="utf-8"))
    for chunk in record.get("chunks", []):
        if chunk["id"] == chunk_id:
            outputs = {
                a: _strip(chunk[a], verbose)
                for a in record.get("analyzers", [])
                if chunk.get(a)
            }
            return {
                "video_id": video_id,
                "chunk_id": chunk_id,
                "start": chunk["start"],
                "end": chunk["end"],
                "timecode": f"{_timecode(chunk['start'])}-{_timecode(chunk['end'])}",
                **outputs,
            }
    return None


def query(
    text: str,
    video_ids: list[str] | None = None,
    analyzer_id: str = "default_video",
    field: str = "combined",
    limit: int = 5,
    score_threshold: float | None = None,
    synthesize: bool = True,
    filters: dict | None = None,
    detail: str = "standard",
    chunk_store: ChunkStore | None = None,
    model: str | None = None,
) -> dict:
    """Retrieve matching chunks and (optionally) synthesise a cited answer.

    `detail` controls how much of each hit comes back: "minimal" for an agent
    that will follow up on the ones it cares about, "standard" for the UI,
    "full" for every nested record.

    `filters` is passed through to the store against FILTER_SPEC, so a filter
    added there is reachable here immediately. Unknown keys raise rather than
    being ignored - a dropped filter returns plausible but wrong results.
    """
    analyzers.get(analyzer_id)  # validate
    if detail not in DETAIL_LEVELS:
        raise ValueError(f"Unknown detail {detail!r}; expected one of {list(DETAIL_LEVELS)}")

    # `video_ids` and `analyzer` stay first-class because every caller uses
    # them; they simply join the filter dict on the way down.
    active = dict(filters or {})
    if video_ids:
        active["video_ids"] = video_ids
    active["analyzer_ids"] = [analyzer_id]

    cs = chunk_store or ChunkStore()
    owns_store = chunk_store is None
    try:
        hits = cs.search(
            text,
            field=field,
            limit=limit,
            score_threshold=score_threshold,
            **active,
        )
    finally:
        if owns_store:
            cs.close()

    results = [_shape(h, detail) for h in hits]

    answer = None
    if synthesize and results:
        answer = _synthesize(text, results, model=model)

    return {"query": text, "analyzer": analyzer_id, "field": field,
            "detail": detail, "answer": answer, "results": results}


def answer(
    question: str,
    video_ids: list[str] | None = None,
    analyzer_id: str | None = None,
    limit: int = 6,
    chunk_store: ChunkStore | None = None,
    model: str | None = None,
) -> dict:
    """Answer a question using a video's aggregates as well as its segments.

    Distinct from `query`, which retrieves segments and summarises the ones it
    found. Here the question is routed to whichever aggregates can answer it -
    entity narratives for questions about a person, novelty for "what is
    unusual", statistics for counts - because those already contain the
    cross-segment reasoning that searching chunks one at a time cannot recover.
    """
    from . import ask as ask_module

    videos = video_ids or [v["video_id"] for v in list_videos()]
    if not videos:
        return {"question": question, "answer": None, "sources": {}, "results": [],
                "error": "No videos ingested."}

    cs = chunk_store or ChunkStore()
    owns_store = chunk_store is None
    contexts, sources, results = [], {}, []
    try:
        for video_id in videos:
            path = record_path_for(video_id)
            if path is None:
                continue
            record = json.loads(path.read_text(encoding="utf-8"))
            analyzers_present = record.get("analyzers", [])
            search_as = analyzer_id or next(
                (a for a in ("default_video", "people", "diarization", "transcript",
                             "object_detection", "ocr") if a in analyzers_present),
                None,
            )
            hits = []
            if search_as:
                hits = cs.search(
                    question, field="combined", limit=limit,
                    video_ids=[video_id], analyzer_ids=[search_as],
                )
            shaped = [_shape(h, "standard") for h in hits]
            results.extend(shaped)
            context, used = ask_module.build_context(question, record, shaped)
            if context:
                contexts.append(f"=== VIDEO {video_id} ===\n{context}")
                sources[video_id] = used
    finally:
        if owns_store:
            cs.close()

    if not contexts:
        return {"question": question, "answer": None, "sources": {}, "results": [],
                "error": "Nothing indexed for the requested videos."}

    from ..extractors.video.openai_call import DEFAULT_MODEL, _get_client

    response = _get_client().chat.completions.create(
        model=model or DEFAULT_MODEL,
        messages=[{"role": "user", "content": ask_module.PROMPT.format(
            question=question, context="\n\n".join(contexts))}],
    )
    return {
        "question": question,
        "answer": response.choices[0].message.content.strip(),
        "sources": sources,
        "results": results,
    }


SYNTHESIS_PROMPT = """\
You are answering a question about video footage using retrieved segment \
descriptions. Answer only from the segments provided - if they do not support an \
answer, say so plainly.

Cite the segment behind every claim as [video_id start-end], using the exact \
timecodes given. Keep it to a few sentences.

Question: {question}

Segments:
{segments}"""


def _synthesize(question: str, results: list[dict], model: str | None = None) -> str:
    from ..extractors.video.openai_call import DEFAULT_MODEL, _get_client

    # Whichever body the detail level carried: `text` only appears at
    # detail="full", `snippet` only at "minimal", `description` in between.
    segments = "\n\n".join(
        f"[{r['video_id']} {r['start']:.2f}-{r['end']:.2f}s] (score {r['score']})\n"
        f"{r.get('text') or r.get('description') or r.get('snippet') or ''}"
        for r in results
    )
    prompt = SYNTHESIS_PROMPT.format(question=question, segments=segments)

    response = _get_client().chat.completions.create(
        model=model or DEFAULT_MODEL,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content.strip()
