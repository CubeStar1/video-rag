import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query

from app.clients import get_collection, get_video, update_video_row
from app.schemas import (
    AnalyzerEntry,
    IndexEntry,
    IngestRequest,
    IngestResponse,
    TranscriptResponse,
    VideoDetailResponse,
    VideoStatusResponse,
)
from app.services import ingest as ingest_service
from app.services import retrieval as retrieval_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/videos", tags=["videos"])


@router.post("/ingest", response_model=IngestResponse)
def ingest(request: IngestRequest, background: BackgroundTasks) -> IngestResponse:
    """Upload a public URL into VideoDB, then index it in the background."""
    update_video_row(
        request.db_video_id,
        {
            "status": "ingesting",
            "index_status": {"step": "uploading", "message": "Uploading to VideoDB…"},
        },
    )

    try:
        video = ingest_service.upload_video(request.source_url, request.title)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Upload failed for %s", request.source_url)
        update_video_row(
            request.db_video_id,
            {"status": "failed", "error": str(exc), "index_status": {"step": "failed"}},
        )
        raise HTTPException(status_code=502, detail=f"VideoDB upload failed: {exc}") from exc

    payload = ingest_service.video_payload(video)
    update_video_row(
        request.db_video_id,
        {
            **payload,
            "status": "indexing",
            "error": None,
            "index_status": {"step": "queued", "message": "Queued for indexing…"},
        },
    )

    background.add_task(ingest_service.run_indexing_pipeline, video.id, request.db_video_id)

    return IngestResponse(
        videodb_video_id=video.id,
        collection_id=video.collection_id,
        title=getattr(video, "name", None) or request.title,
        duration=payload["duration"],
        thumbnail_url=payload["thumbnail_url"],
        stream_url=payload["stream_url"],
        player_url=payload["player_url"],
        status="indexing",
    )


@router.get("/{videodb_video_id}", response_model=VideoDetailResponse)
def detail(videodb_video_id: str) -> VideoDetailResponse:
    try:
        video = get_video(videodb_video_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=404, detail=f"Video not found: {exc}") from exc

    stream_url = getattr(video, "stream_url", None)
    return VideoDetailResponse(
        videodb_video_id=video.id,
        title=getattr(video, "name", None),
        duration=getattr(video, "length", None),
        thumbnail_url=ingest_service.resolve_thumbnail(video),
        stream_url=stream_url,
        player_url=ingest_service.player_url(stream_url),
        indexes=[IndexEntry(**entry) for entry in ingest_service.describe_indexes(video)],
    )


@router.get("/{videodb_video_id}/status", response_model=VideoStatusResponse)
def status(videodb_video_id: str) -> VideoStatusResponse:
    """Live status straight from VideoDB, independent of the Supabase row."""
    try:
        video = get_video(videodb_video_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=404, detail=f"Video not found: {exc}") from exc

    indexes = ingest_service.describe_indexes(video)
    analyzers: list[AnalyzerEntry] = []
    try:
        for understanding in video.list_understandings() or []:
            analyzers.extend(
                AnalyzerEntry(name=analyzer.name, status=analyzer.status)
                for analyzer in understanding.list_analyzers()
            )
    except Exception:  # noqa: BLE001
        logger.debug("list_understandings failed for %s", videodb_video_id, exc_info=True)

    ready = any(entry.get("status") == "ready" for entry in indexes)
    building = any(entry.get("status") == "building" for entry in indexes)
    resolved = "ready" if ready else "indexing" if building or analyzers else "pending"

    return VideoStatusResponse(
        videodb_video_id=videodb_video_id,
        status=resolved,
        step=resolved,
        analyzers=analyzers,
        indexes=[IndexEntry(**entry) for entry in indexes],
    )


@router.post("/{videodb_video_id}/reindex", response_model=VideoStatusResponse)
def reindex(
    videodb_video_id: str,
    background: BackgroundTasks,
    db_video_id: str | None = Query(default=None),
) -> VideoStatusResponse:
    background.add_task(ingest_service.run_indexing_pipeline, videodb_video_id, db_video_id)
    if db_video_id:
        update_video_row(
            db_video_id,
            {
                "status": "indexing",
                "error": None,
                "index_status": {"step": "queued", "message": "Re-indexing…"},
            },
        )
    return VideoStatusResponse(
        videodb_video_id=videodb_video_id,
        status="indexing",
        step="queued",
        message="Re-indexing started",
    )


@router.delete("/{videodb_video_id}")
def delete(videodb_video_id: str) -> dict[str, bool]:
    try:
        get_collection().delete_video(videodb_video_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Delete failed: {exc}") from exc
    return {"deleted": True}


@router.get("/{videodb_video_id}/transcript", response_model=TranscriptResponse)
def transcript(
    videodb_video_id: str,
    start: float | None = Query(default=None),
    end: float | None = Query(default=None),
    segmenter: str = Query(default="sentence", pattern="^(sentence|word|time)$"),
    length: int = Query(default=1, ge=1, description="Segment length in seconds, `time` only"),
) -> TranscriptResponse:
    try:
        segments, text = retrieval_service.get_transcript(
            videodb_video_id, start, end, segmenter=segmenter, length=length
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=409,
            detail=f"No transcript available yet — the video may still be indexing ({exc})",
        ) from exc
    return TranscriptResponse(
        videodb_video_id=videodb_video_id,
        start=start,
        end=end,
        segmenter=segmenter,
        text=text,
        segments=segments,
    )
