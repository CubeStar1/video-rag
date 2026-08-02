"""Upload a video into VideoDB, then run the understand -> index pipeline.

The pipeline is slow (tens of minutes is normal), so it runs as a background task
and reports progress by writing to the Supabase `videos` row. The frontend polls.
"""

import logging
import time
from typing import Any

from videodb.video import Video

from app.clients import get_collection, get_video, update_video_row
from app.config import get_settings

logger = logging.getLogger(__name__)

PLAYER_BASE = "https://console.videodb.io/player?url="

# Enum vocabularies keep aggregate(group_by=...) buckets clean instead of free text.
ACTIVITY_VALUES = [
    "conversation",
    "presentation",
    "demonstration",
    "using_device",
    "walking",
    "driving",
    "object_interaction",
    "performance",
    "other",
]

SCENE_SCHEMA: dict[str, Any] = {
    "scene_description": "text",
    "on_screen_text": "text",
    "activity": {"type": "enum", "values": ACTIVITY_VALUES},
    "setting": {
        "type": "object",
        "fields": {
            "location_type": {
                "type": "enum",
                "values": ["office", "home", "outdoor", "vehicle", "studio", "other"],
            },
            "environment": {"type": "enum", "values": ["indoor", "outdoor", "unknown"]},
        },
    },
    "visible_objects": ["string"],
}

SCENE_PROMPT = (
    "Describe this scene for a video search index. Cover: who and what is visible, "
    "the setting, any text shown on screen, and what is happening. Be specific and "
    "factual — this description is what users will search against."
)


def player_url(stream_url: str | None) -> str | None:
    return f"{PLAYER_BASE}{stream_url}" if stream_url else None


def video_payload(video: Video) -> dict[str, Any]:
    stream_url = getattr(video, "stream_url", None)
    return {
        "videodb_video_id": video.id,
        "videodb_collection_id": video.collection_id,
        "duration": getattr(video, "length", None) or None,
        "thumbnail_url": getattr(video, "thumbnail_url", None),
        "stream_url": stream_url,
        "player_url": player_url(stream_url),
    }


def upload_video(source_url: str, title: str | None = None) -> Video:
    """Ingest a public URL (direct file or YouTube) into the default collection."""
    collection = get_collection()
    video = collection.upload(url=source_url, name=title)
    if video is None:
        raise RuntimeError("VideoDB upload returned no video")
    return video


def _analyzer_entries(understanding) -> list[dict[str, Any]]:
    return [
        {"name": analyzer.name, "status": analyzer.status}
        for analyzer in understanding.list_analyzers()
    ]


def _write_status(db_video_id: str | None, **payload: Any) -> None:
    if db_video_id:
        update_video_row(db_video_id, payload)


def run_indexing_pipeline(videodb_video_id: str, db_video_id: str | None = None) -> None:
    """Understand -> index. Safe to call as a fire-and-forget background task."""
    settings = get_settings()

    try:
        video = get_video(videodb_video_id)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Could not load video %s", videodb_video_id)
        _write_status(db_video_id, status="failed", error=str(exc))
        return

    try:
        _write_status(
            db_video_id,
            status="indexing",
            index_status={"step": "understanding", "message": "Analyzing video…"},
        )

        understanding = video.understand(
            transform={"resolution": settings.transform_resolution},
            segmentation={
                "type": "shot",
                "threshold": settings.shot_threshold,
                "min_scene_len": settings.min_scene_len,
            },
            analyzers=[
                {"type": "spoken_words", "name": "transcript"},
                {
                    "type": "vlm",
                    "name": "scene",
                    "sampling": {"strategy": "uniform", "frame_count": settings.vlm_frame_count},
                    "config": {
                        "model": settings.vlm_model,
                        "prompt": SCENE_PROMPT,
                        "schema": SCENE_SCHEMA,
                    },
                },
            ],
        )

        # A run with a failed/skipped analyzer ends `partial`, which the SDK does not
        # treat as terminal — so poll the analyzers, not the run. The emptiness guard is
        # load-bearing: all([]) is True and would exit while the run is still going.
        deadline = time.time() + settings.index_timeout_seconds
        while time.time() < deadline:
            analyzers = understanding.refresh().list_analyzers()
            if analyzers and all(analyzer.is_complete for analyzer in analyzers):
                break
            _write_status(
                db_video_id,
                index_status={
                    "step": "understanding",
                    "message": "Analyzing video…",
                    "analyzers": _analyzer_entries(understanding),
                },
            )
            time.sleep(settings.index_poll_seconds)
        else:
            raise TimeoutError(
                f"Understanding did not finish within {settings.index_timeout_seconds}s"
            )

        analyzers = understanding.list_analyzers()
        successful = [analyzer for analyzer in analyzers if analyzer.is_successful]
        if not successful:
            raise RuntimeError("Every analyzer failed — nothing to index")

        _write_status(
            db_video_id,
            index_status={
                "step": "indexing",
                "message": "Building search indexes…",
                "analyzers": _analyzer_entries(understanding),
            },
        )

        built: list[dict[str, Any]] = []
        for analyzer in successful:
            try:
                # name=analyzer.name is safe here because every analyzer above is named.
                index = video.index(source=analyzer, name=analyzer.name)
                if index is not None:
                    index.wait_until_complete(
                        timeout=settings.index_timeout_seconds,
                        poll_interval=settings.index_poll_seconds,
                    )
                    built.append(
                        {
                            "name": getattr(index, "name", analyzer.name),
                            "status": getattr(index, "status", None),
                            "record_count": getattr(index, "record_count", None),
                        }
                    )
            except Exception as exc:  # noqa: BLE001 - one bad index shouldn't sink the rest
                logger.exception("Indexing analyzer %s failed", analyzer.name)
                built.append({"name": analyzer.name, "status": "failed", "error": str(exc)})

        # v1 spoken-word index — `add_subtitle()` and `get_transcript_text()` read this,
        # and a v2 `transcript` artifact does not substitute for it.
        try:
            video.index_spoken_words(force=True)
        except Exception:  # noqa: BLE001 - transcript is a bonus, not the point
            logger.warning("index_spoken_words failed for %s", videodb_video_id, exc_info=True)

        if not any(entry.get("status") not in (None, "failed") for entry in built):
            raise RuntimeError("No index finished building")

        _write_status(
            db_video_id,
            status="ready",
            error=None,
            index_status={
                "step": "ready",
                "message": "Ready to search",
                "analyzers": _analyzer_entries(understanding),
                "indexes": built,
            },
        )
        logger.info("Indexing complete for %s", videodb_video_id)

    except Exception as exc:  # noqa: BLE001
        logger.exception("Indexing pipeline failed for %s", videodb_video_id)
        _write_status(
            db_video_id,
            status="failed",
            error=str(exc),
            index_status={"step": "failed", "message": str(exc)},
        )


def describe_indexes(video: Video) -> list[dict[str, Any]]:
    try:
        indexes = video.list_indexes() or []
    except Exception:  # noqa: BLE001
        logger.warning("list_indexes failed for %s", video.id, exc_info=True)
        return []
    return [
        {
            "name": getattr(index, "name", None),
            "status": getattr(index, "status", None),
            "record_count": getattr(index, "record_count", None),
            "use_for": getattr(index, "use_for", None),
        }
        for index in indexes
    ]
