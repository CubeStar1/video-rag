import os
import warnings

# Must precede any transformers import. transformers probes for TensorFlow and
# imports it if present, which pulls in oneDNN/absl banners and several seconds
# of startup for a backend nothing here uses.
os.environ.setdefault("USE_TF", "0")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")
warnings.filterwarnings("ignore")

import mimetypes
import re
import shutil
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from .. import aggregators, analyzers
from ..paths import UPLOAD_DIR, ensure as ensure_dirs
from ..vectordb.render import VECTOR_FIELDS
from ..vectordb.store import FILTER_SPEC
from . import core, jobs, ui

app = FastAPI(
    title="VideoMind",
    version="0.1.0",
    description="Video RAG: chunk, analyse, aggregate, search and ask.",
)

# The API is the product; the UI is one optional client of it.
if ui.enabled():
    app.include_router(ui.router)


@app.get("/health")
def health():
    """Liveness plus what this instance has loaded."""
    return {
        "status": "ok",
        "ui": ui.enabled(),
        "analyzers": analyzers.available(),
        "aggregators": aggregators.available(),
    }


@app.get("/media/{video_id}")
def media(video_id: str, request: Request):
    """Stream an ingested video, honouring Range requests.

    Range support is what makes seeking work: without 206 responses the
    browser can only play from the start, so clicking a timestamp would do
    nothing.
    """
    path = core.video_path_for(video_id)
    if not path or not Path(path).exists():
        raise HTTPException(404, f"No media for video_id {video_id!r}")

    file_path = Path(path)
    size = file_path.stat().st_size
    media_type = mimetypes.guess_type(str(file_path))[0] or "video/mp4"

    range_header = request.headers.get("range")
    if not range_header:
        return FileResponse(file_path, media_type=media_type)

    match = re.match(r"bytes=(\d*)-(\d*)", range_header)
    if not match:
        raise HTTPException(416, "Malformed Range header")
    start = int(match.group(1) or 0)
    end = int(match.group(2)) if match.group(2) else size - 1
    end = min(end, size - 1)
    if start > end:
        raise HTTPException(416, "Range not satisfiable")

    with file_path.open("rb") as handle:
        handle.seek(start)
        data = handle.read(end - start + 1)

    return Response(
        content=data,
        status_code=206,
        media_type=media_type,
        headers={
            "Content-Range": f"bytes {start}-{end}/{size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(len(data)),
        },
    )


class QueryRequest(BaseModel):
    text: str
    video_ids: list[str] | None = None
    analyzer: str = "default_video"
    field: str = "combined"
    limit: int = Field(5, ge=1, le=50)
    score_threshold: float | None = None
    synthesize: bool = True
    detail: str = "standard"
    # Passed straight through to the store's FILTER_SPEC. Keeping this generic
    # is what stopped six store filters from being silently unreachable.
    filters: dict = Field(default_factory=dict)


@app.get("/analyzers")
def list_analyzers():
    return {
        "analyzers": analyzers.available(),
        "fields": list(VECTOR_FIELDS),
        # Sets that cannot be selected together, so a UI can enforce it.
        "exclusive_groups": [sorted(g) for g in analyzers.EXCLUSIVE_GROUPS],
    }


@app.get("/schema")
def schema():
    """What can be searched and filtered.

    Discovery matters more than raw generality for an agent: given a free-form
    filter object it would otherwise have to guess field names and semantics.
    """
    return {
        "analyzers": analyzers.available(),
        "exclusive_groups": [sorted(g) for g in analyzers.EXCLUSIVE_GROUPS],
        "vector_fields": {
            "combined": "whole flattened record (default)",
            "description": "prose summary only",
            "people": "person descriptions only",
            "actions": "actions and what objects are used for",
            "objects": "object names only",
        },
        "detail_levels": {
            "minimal": "ids, timecodes, score, short snippet - for agents",
            "standard": "plus description and facets - for the UI",
            "full": "plus every nested record",
        },
        "filters": {
            name: {"type": spec["type"], "matches": spec["kind"], "payload_field": spec["key"]}
            for name, spec in FILTER_SPEC.items()
        },
        "aggregators": {
            name: {
                "depends_on": list(agg.depends_on),
                "uses_llm": name in aggregators.USES_LLM,
            }
            for name, agg in sorted(aggregators.REGISTRY.items())
        },
    }


@app.get("/videos")
def list_videos():
    return {"videos": core.list_videos()}


@app.get("/videos/{video_id}")
def get_video(video_id: str):
    video = core.get_video(video_id)
    if video is None:
        raise HTTPException(404, f"No such video {video_id!r}")
    return video


@app.get("/videos/{video_id}/chunks")
def get_chunks(
    video_id: str,
    analyzer: str | None = None,
    after: float | None = None,
    before: float | None = None,
    chunk_ids: str | None = Query(None, description="Comma-separated chunk ids"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    verbose: bool = False,
):
    """Stored analyzer output, scoped by analyzer and time range.

    The read counterpart to /query: fetch what was produced rather than
    searching it. Always bounded, so a caller cannot pull a whole video in
    one go.
    """
    try:
        ids = [int(x) for x in chunk_ids.split(",") if x.strip()] if chunk_ids else None
    except ValueError as exc:
        raise HTTPException(400, f"chunk_ids must be comma-separated integers: {exc}") from exc

    try:
        result = core.get_chunks(
            video_id, analyzer_id=analyzer, after=after, before=before,
            chunk_ids=ids, limit=limit, offset=offset, verbose=verbose,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if result is None:
        raise HTTPException(404, f"No such video {video_id!r}")
    return result


@app.get("/videos/{video_id}/aggregates")
def get_aggregates(video_id: str, aggregator: str | None = None):
    """Video-level results: summary, chapters, events, stats, entities, and so on."""
    try:
        result = core.get_aggregates(video_id, aggregator_id=aggregator)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if result is None:
        raise HTTPException(404, f"No such video {video_id!r}")
    return result


@app.post("/videos/{video_id}/aggregates", status_code=202)
def run_aggregates(video_id: str,
                   aggregators_csv: str | None = Form(None, alias="aggregators"),
                   force: bool = Query(True, description="Recompute even if already stored")):
    """Re-run aggregators over already-analysed output.

    Separate from upload because aggregators read `records/` rather than the
    video: re-summarising or re-linking after a change costs no re-analysis.
    """
    if core.record_path_for(video_id) is None:
        raise HTTPException(404, f"No such video {video_id!r}")
    ids = [a.strip() for a in aggregators_csv.split(",") if a.strip()] if aggregators_csv else None
    try:
        if ids:
            for name in ids:
                aggregators.get(name)
    except KeyError as exc:
        raise HTTPException(400, str(exc)) from exc

    job_id = jobs.create()
    jobs.run_in_background(job_id, core.run_aggregators, video_id, aggregator_ids=ids, force=force)
    return {"job_id": job_id, "status": "queued", "video_id": video_id}


@app.get("/videos/{video_id}/entities")
def get_entities(video_id: str, min_appearances: int = Query(1, ge=1)):
    """People linked across chunks, with their timelines."""
    try:
        result = core.get_aggregates(video_id, aggregator_id="entities")
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if result is None:
        raise HTTPException(404, f"No such video {video_id!r}")

    entities = [
        e for e in result["result"]["entities"]
        if e["appearances"] >= min_appearances
    ]
    timelines = {}
    try:
        stored = core.get_aggregates(video_id, aggregator_id="entity_timelines")
        timelines = {t["entity_id"]: t for t in stored["result"]["timelines"]}
    except ValueError:
        pass  # timelines are optional

    for entity in entities:
        if entity["entity_id"] in timelines:
            entity["timeline"] = timelines[entity["entity_id"]]
    return {"video_id": video_id, "total": len(entities), "entities": entities}


@app.get("/videos/{video_id}/chunks/{chunk_id}")
def get_chunk(video_id: str, chunk_id: int, verbose: bool = False):
    chunk = core.get_chunk(video_id, chunk_id, verbose=verbose)
    if chunk is None:
        raise HTTPException(404, f"No chunk {chunk_id} in video {video_id!r}")
    return chunk


@app.post("/videos", status_code=202)
async def upload_video(
    file: UploadFile = File(...),
    analyzers_csv: str = Form("default_video", alias="analyzers"),
    mode: str = Form("preset"),
    preset: str = Form("audio_video"),
    interval: float | None = Form(None),
    speaker: float | None = Form(None),
    silence: float | None = Form(None),
    cut: float | None = Form(None),
    semantic: float | None = Form(None),
    min_duration: float = Form(5.0),
    max_duration: float = Form(20.0),
):
    """Upload a video and start ingestion.

    mode="preset"   -> `preset` names a weighting
    mode="weights"  -> speaker/silence/cut/semantic set a custom weighting
    mode="interval" -> `interval` seconds per chunk, min/max not applied
    """
    analyzer_ids = [a.strip() for a in analyzers_csv.split(",") if a.strip()]
    try:
        analyzers.validate_selection(analyzer_ids)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    kwargs = {"preset": None, "weights": None, "interval": None}
    if mode == "preset":
        kwargs["preset"] = preset
    elif mode == "weights":
        weights = {"speaker": speaker, "silence": silence, "cut": cut, "semantic": semantic}
        weights = {k: v for k, v in weights.items() if v is not None}
        if not weights:
            raise HTTPException(400, "mode=weights needs at least one of speaker/silence/cut/semantic")
        kwargs["weights"] = weights
    elif mode == "interval":
        if not interval:
            raise HTTPException(400, "mode=interval needs `interval` seconds")
        kwargs["interval"] = interval
    else:
        raise HTTPException(400, f"Unknown mode {mode!r}; expected preset|weights|interval")

    ensure_dirs()
    dest = UPLOAD_DIR / file.filename
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    job_id = jobs.create()
    jobs.run_in_background(
        job_id,
        core.upload,
        str(dest),
        analyzer_ids=analyzer_ids,
        min_duration=min_duration,
        max_duration=max_duration,
        **kwargs,
    )
    return {"job_id": job_id, "status": "queued", "video_path": str(dest)}


@app.get("/jobs/{job_id}")
def job_status(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, f"No such job {job_id!r}")
    return job


@app.get("/jobs")
def all_jobs():
    return {"jobs": jobs.all_jobs()}


class AskRequest(BaseModel):
    question: str
    video_ids: list[str] | None = None
    analyzer: str | None = None
    limit: int = Field(6, ge=1, le=20)


@app.post("/ask")
def ask(request: AskRequest):
    """Answer a question using the video's aggregates as well as its segments.

    `/query` finds segments; this answers questions. The question is routed to
    whichever aggregates can address it, so "what did the woman in grey do"
    reaches the entity narratives and "which part is unusual" reaches novelty.
    """
    if request.analyzer and request.analyzer not in analyzers.available():
        raise HTTPException(400, f"Unknown analyzer {request.analyzer!r}")
    return core.answer(
        request.question,
        video_ids=request.video_ids,
        analyzer_id=request.analyzer,
        limit=request.limit,
    )


@app.post("/query")
def query(request: QueryRequest):
    if request.analyzer not in analyzers.available():
        raise HTTPException(400, f"Unknown analyzer {request.analyzer!r}")
    if request.field not in VECTOR_FIELDS:
        raise HTTPException(400, f"Unknown field {request.field!r}; have {list(VECTOR_FIELDS)}")
    if request.detail not in core.DETAIL_LEVELS:
        raise HTTPException(400, f"Unknown detail {request.detail!r}; have {list(core.DETAIL_LEVELS)}")
    try:
        return core.query(
            request.text,
            video_ids=request.video_ids,
            analyzer_id=request.analyzer,
            field=request.field,
            limit=request.limit,
            score_threshold=request.score_threshold,
            synthesize=request.synthesize,
            detail=request.detail,
            filters=request.filters,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
