import logging

from fastapi import APIRouter, HTTPException

from app.schemas import (
    AggregateRequest,
    AggregateResponseOut,
    AskRequest,
    AskResponseOut,
    ClipRequest,
    ClipResponse,
    QueryRequest,
    SearchRequest,
    SearchResponseOut,
    SemanticSearchRequest,
    ShotOut,
)
from app.services import retrieval as service
from app.services.ingest import player_url

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/retrieval", tags=["retrieval"])


@router.post("/search", response_model=SearchResponseOut)
def search(request: SearchRequest) -> SearchResponseOut:
    if not request.video_ids:
        raise HTTPException(status_code=400, detail="video_ids must not be empty")

    shots, compiled, errors = service.search_moments(
        request.video_ids, request.query, request.top_k, request.return_fields
    )
    return SearchResponseOut(
        query=request.query,
        shots=shots,
        compiled_stream_url=compiled,
        compiled_player_url=player_url(compiled),
        errors=errors,
    )


@router.post("/ask", response_model=AskResponseOut)
def ask(request: AskRequest) -> AskResponseOut:
    if not request.video_ids:
        raise HTTPException(status_code=400, detail="video_ids must not be empty")

    answer, sources, errors = service.ask_videos(
        request.video_ids, request.question, request.top_k
    )
    service.hydrate_streams(sources)
    return AskResponseOut(
        question=request.question, answer=answer, sources=sources, errors=errors
    )


@router.post("/semantic-search", response_model=SearchResponseOut)
def semantic_search(request: SemanticSearchRequest) -> SearchResponseOut:
    if not request.video_ids:
        raise HTTPException(status_code=400, detail="video_ids must not be empty")

    shots, errors = service.semantic_search(
        request.video_ids,
        request.query,
        request.index_names,
        request.top_k,
        request.score_threshold,
    )
    service.hydrate_streams(shots)
    compiled = None
    try:
        compiled = service.compile_shots(shots)
    except Exception:  # noqa: BLE001
        logger.debug("compile failed", exc_info=True)

    return SearchResponseOut(
        query=request.query,
        shots=shots,
        compiled_stream_url=compiled,
        compiled_player_url=player_url(compiled),
        errors=errors,
    )


@router.post("/query", response_model=list[ShotOut])
def query(request: QueryRequest) -> list[ShotOut]:
    try:
        return service.query_index(
            request.video_id,
            request.index_name,
            request.filter,
            request.limit,
            request.sort,
            request.return_fields,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/aggregate", response_model=AggregateResponseOut)
def aggregate(request: AggregateRequest) -> AggregateResponseOut:
    try:
        rows = service.aggregate_index(
            request.video_id,
            request.index_name,
            request.group_by,
            request.metric,
            request.filter,
            request.limit,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return AggregateResponseOut(
        index_name=request.index_name,
        group_by=request.group_by,
        metric=request.metric,
        rows=rows,
    )


@router.post("/clip", response_model=ClipResponse)
def clip(request: ClipRequest) -> ClipResponse:
    try:
        stream_url = service.compile_clip(request.video_id, request.timestamps)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return ClipResponse(
        video_id=request.video_id,
        stream_url=stream_url,
        player_url=player_url(stream_url) or "",
        timestamps=request.timestamps,
    )
