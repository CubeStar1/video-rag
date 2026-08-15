import os
import warnings

os.environ.setdefault("USE_TF", "0")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")
warnings.filterwarnings("ignore")

import shutil
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field

from .. import aggregators, analyzers, storage, youtube
from ..paths import UPLOAD_DIR, ensure as ensure_dirs
from ..vectordb.render import VECTOR_FIELDS
from ..vectordb.store import FILTER_SPEC
from . import core, jobs, ui

app = FastAPI(
    title="FalconVQA",
    version="0.1.0",
    description="Video RAG: chunk, analyse, aggregate, search and ask.",
)

API_TOKEN = os.environ.get("VIDEOMIND_API_TOKEN", "").strip()

_OPEN_PATHS = {"/", "/health", "/docs", "/redoc", "/openapi.json"}


@app.middleware("http")
async def require_token(request: Request, call_next):
    if API_TOKEN and request.url.path not in _OPEN_PATHS:
        if request.headers.get("x-core-token") != API_TOKEN:
            return JSONResponse({"detail": "Invalid or missing X-Core-Token"}, status_code=401)
    return await call_next(request)


if ui.enabled():
    app.include_router(ui.router)


@app.get("/health")
def health():

    store_status = storage.status()
    ffmpeg = youtube.ffmpeg_path()
    return {
        "status": "ok" if store_status["ok"] else "degraded",
        "ui": ui.enabled(),
        "storage": store_status,
        "youtube": {
            "enabled": youtube.available(),
            "ffmpeg": ffmpeg,
            "max_quality": "1080p" if ffmpeg else "360p (install ffmpeg for more)",
        },
        "analyzers": analyzers.available(),
        "aggregators": aggregators.available(),
    }


@app.get("/media/{video_id}")
def media(video_id: str):

    url = core.video_url_for(video_id)
    if not url:
        raise HTTPException(404, f"No media for video_id {video_id!r}")
    return RedirectResponse(url, status_code=307)


class QueryRequest(BaseModel):
    text: str
    video_ids: list[str] | None = None
    analyzer: str = "default_video"
    field: str = "combined"
    limit: int = Field(5, ge=1, le=50)
    score_threshold: float | None = None
    synthesize: bool = True
    detail: str = "standard"
    filters: dict = Field(default_factory=dict)


@app.get("/analyzers")
def list_analyzers():
    return {
        "analyzers": analyzers.available(),
        "fields": list(VECTOR_FIELDS),
        "exclusive_groups": [sorted(g) for g in analyzers.EXCLUSIVE_GROUPS],
    }


@app.get("/schema")
def schema():

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


@app.delete("/videos/{video_id}")
def delete_video(video_id: str):

    result = core.delete_video(video_id)
    if result is None:
        raise HTTPException(404, f"No such video {video_id!r}")
    return result


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
        pass

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


def _ingest_params(
    analyzers_csv: str,
    mode: str,
    preset: str,
    interval: float | None,
    speaker: float | None,
    silence: float | None,
    cut: float | None,
    semantic: float | None,
) -> tuple[list[str], dict]:

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

    return analyzer_ids, kwargs


class IngestRequest(BaseModel):

    url: str
    analyzers: str = "default_video"
    mode: str = "preset"
    preset: str = "audio_video"
    interval: float | None = None
    speaker: float | None = None
    silence: float | None = None
    cut: float | None = None
    semantic: float | None = None
    min_duration: float = 5.0
    max_duration: float = 20.0


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

    analyzer_ids, kwargs = _ingest_params(
        analyzers_csv, mode, preset, interval, speaker, silence, cut, semantic
    )

    ensure_dirs()
    dest = UPLOAD_DIR / Path(file.filename or "video.mp4").name
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
    return {"job_id": job_id, "status": "queued", "source": dest.name}


@app.post("/videos/url", status_code=202)
def ingest_url(request: IngestRequest):

    analyzer_ids, kwargs = _ingest_params(
        request.analyzers, request.mode, request.preset, request.interval,
        request.speaker, request.silence, request.cut, request.semantic,
    )
    try:
        core.validate_source(request.url)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    job_id = jobs.create()
    jobs.run_in_background(
        job_id,
        core.upload,
        request.url,
        analyzer_ids=analyzer_ids,
        min_duration=request.min_duration,
        max_duration=request.max_duration,
        **kwargs,
    )
    return {"job_id": job_id, "status": "queued", "source": request.url}


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
