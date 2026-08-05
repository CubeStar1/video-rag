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

# One purpose-built analyzer per signal, each on VideoDB's own prompt and output shape.
# We only choose the model tier and the frame budget; everything else is the default.
# (type, name) — the name is also the index name, so it must stay stable across videos:
# a shared name is what lets one search fan out over the whole collection.
VLM_BACKED_ANALYZERS = [
    ("vlm", "scene"),  # scene_description, action, activity, location, setting, …
    ("ocr", "ocr"),  # combined_text, text, words, language
    ("activity_recognition", "activity"),  # labels, activity, actions, detections
    ("location_detection", "location"),  # location_type, setting, time_of_day, location
    ("brand_detection", "brands"),  # brand_names, brands, summary, detections
]


# VideoDB derives an index's structure from the records it is handed, and the name is
# a permanent collection-wide contract — so a key that is only sometimes present makes
# one video's index incompatible with the next one's, forever. `spoken_words` emits
# `words` only when it detects speech, so a silent video and a speaking video cannot
# otherwise share the `transcript` name. Projecting onto a fixed key list pins the
# shape. Nothing reads `words` off the index (the transcript endpoint uses the v1
# `get_transcript()` path), so dropping it costs nothing.
#
# Everything else was verified to emit the same keys for both a speaking and a silent
# video, so those artifacts are still indexed by reference — cheaper, since their scene
# data never leaves the server. Add an entry here if another one starts drifting.
#
# Declaring `fields=` on index() is NOT an alternative: it selects which stored fields
# get retrieval optimisation, but every key on the record is stored either way and the
# contract is on what is stored. Verified — two record sets with identical `fields` and
# one extra key still collided.
PINNED_FIELDS: dict[str, list[str]] = {"transcript": ["text"]}


def index_name(analyzer_name: str) -> str:
    """The index name for an analyzer, within the current name generation.

    Analyzer names are scoped to their run and can be reused freely; index names are a
    schema contract for the whole collection, so a name can only ever hold one field
    shape. `index.delete()` frees a name, but deleting a *video* orphans its indexes
    without freeing theirs — and an orphan can no longer be reached to delete, so its
    name is stuck for good. Bump the generation when that has already happened.
    """
    generation = get_settings().index_generation.strip()
    return f"{analyzer_name}_{generation}" if generation else analyzer_name


def build_analyzers() -> list[dict[str, Any]]:
    """The analyzer set for one understanding run.

    Seven analyzers is deliberately broad — each one costs model calls, so trimming
    `VLM_BACKED_ANALYZERS` is the first lever if a run gets too expensive.
    """
    settings = get_settings()
    sampling = {"strategy": "uniform", "frame_count": settings.vlm_frame_count}

    analyzers: list[dict[str, Any]] = [{"type": "spoken_words", "name": "transcript"}]

    analyzers += [
        {
            "type": kind,
            "name": name,
            "sampling": sampling,
            "config": {"model": settings.vlm_model},
        }
        for kind, name in VLM_BACKED_ANALYZERS
    ]

    # Object detection is not VLM-backed: it takes a detection model rather than a tier,
    # so `vlm_model` must not be passed here. The model must be named explicitly — omit
    # it and the server picks the sandbox-backed `rtdetr-v2-r50vd`, which fails the whole
    # run with "No active sandbox compatible with model". A steady per-second sweep also
    # catches objects that a handful of uniformly spaced frames would miss.
    analyzers.append(
        {
            "type": "object_detection",
            "name": "objects",
            "sampling": {"strategy": "interval", "every": settings.object_interval_seconds},
            "config": {"model": settings.object_detection_model},
        }
    )

    return analyzers


def resolve_segmentation(config: dict[str, Any] | None = None) -> dict[str, Any]:
    """Merge a caller's segmentation choice over the configured defaults.

    Only the keys VideoDB expects for the chosen type are emitted — sending a
    `threshold` alongside `{"type": "time"}` would be silently ignored at best.
    Idempotent, so an already-resolved dict can be passed straight back in.
    """
    settings = get_settings()
    config = config or {}
    kind = config.get("type") or settings.segmentation_type

    if kind == "time":
        seconds = config.get("seconds")
        return {
            "type": "time",
            "seconds": int(seconds) if seconds else settings.time_segment_seconds,
        }

    threshold = config.get("threshold")
    min_scene_len = config.get("min_scene_len")
    return {
        "type": "shot",
        "threshold": int(threshold) if threshold else settings.shot_threshold,
        "min_scene_len": (
            int(min_scene_len) if min_scene_len is not None else settings.min_scene_len
        ),
    }


def player_url(stream_url: str | None) -> str | None:
    return f"{PLAYER_BASE}{stream_url}" if stream_url else None


def resolve_thumbnail(video: Video) -> str | None:
    """A freshly uploaded video often has no thumbnail yet — ask for one."""
    existing = getattr(video, "thumbnail_url", None)
    if existing:
        return existing

    try:
        thumbnail = video.generate_thumbnail()
    except Exception:  # noqa: BLE001 - the video may not be processed yet
        logger.debug("generate_thumbnail failed for %s", video.id, exc_info=True)
        return None

    # Without a `time` argument the SDK returns the URL; with one it returns an Image.
    return thumbnail if isinstance(thumbnail, str) else getattr(thumbnail, "url", None)


def video_payload(video: Video) -> dict[str, Any]:
    stream_url = getattr(video, "stream_url", None)
    return {
        "videodb_video_id": video.id,
        "videodb_collection_id": video.collection_id,
        "duration": getattr(video, "length", None) or None,
        "thumbnail_url": resolve_thumbnail(video),
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


def index_source(analyzer) -> Any:
    """What to hand `video.index()` for this analyzer.

    Returns the analyzer itself — indexed by reference — unless its artifact needs a
    pinned shape, in which case its scenes are projected onto a fixed key list and
    passed as temporal records. Missing keys are filled rather than omitted, so every
    video produces the identical structure.
    """
    keep = PINNED_FIELDS.get(analyzer.name)
    if keep is None:
        return analyzer

    output = analyzer.get_output()
    # The payload is normally {"scenes": [...]} but can be a bare list — handle both.
    scenes = output.get("scenes", output) if isinstance(output, dict) else output

    records: list[dict[str, Any]] = []
    for scene in scenes or []:
        if not isinstance(scene, dict):
            continue
        start, end = scene.get("start"), scene.get("end")
        if start is None or end is None or float(end) <= float(start):
            continue

        data = scene.get("data") or {}
        record: dict[str, Any] = {"start": float(start), "end": float(end)}
        if scene.get("scene_id"):
            record["scene_id"] = scene["scene_id"]
        record.update({key: data.get(key) or "" for key in keep})
        records.append(record)

    return records


def _analyzer_entries(understanding) -> list[dict[str, Any]]:
    return [
        {"name": analyzer.name, "status": analyzer.status}
        for analyzer in understanding.list_analyzers()
    ]


def _write_status(db_video_id: str | None, **payload: Any) -> None:
    if db_video_id:
        update_video_row(db_video_id, payload)


def _tag(videodb_video_id: str) -> str:
    """VideoDB ids are 40 characters and repeat on every line — the tail identifies a run."""
    return videodb_video_id[-8:]


def _elapsed(started: float) -> str:
    seconds = int(time.time() - started)
    return f"{seconds // 60}m{seconds % 60:02d}s" if seconds >= 60 else f"{seconds}s"


def run_indexing_pipeline(
    videodb_video_id: str,
    db_video_id: str | None = None,
    segmentation: dict[str, Any] | None = None,
) -> None:
    """Understand -> index. Safe to call as a fire-and-forget background task."""
    settings = get_settings()
    segmentation = resolve_segmentation(segmentation)
    tag = _tag(videodb_video_id)
    started = time.time()

    try:
        video = get_video(videodb_video_id)
    except Exception as exc:  # noqa: BLE001
        logger.error("[%s] could not load video: %s", tag, exc)
        _write_status(db_video_id, status="failed", error=str(exc))
        return

    try:
        _write_status(
            db_video_id,
            status="indexing",
            index_status={
                "step": "understanding",
                "message": "Analyzing video…",
                "segmentation": segmentation,
            },
        )

        requested = build_analyzers()
        logger.info(
            "[%s] understanding %d analyzers | %s | %s",
            tag,
            len(requested),
            ", ".join(entry["name"] for entry in requested),
            segmentation["type"],
        )

        understanding = video.understand(
            transform={"resolution": settings.transform_resolution},
            segmentation=segmentation,
            analyzers=requested,
        )

        # A run with a failed/skipped analyzer ends `partial`, which the SDK does not
        # treat as terminal — so poll the analyzers, not the run. The emptiness guard is
        # load-bearing: all([]) is True and would exit while the run is still going.
        deadline = time.time() + settings.index_timeout_seconds
        done_count = 0
        while time.time() < deadline:
            analyzers = understanding.refresh().list_analyzers()
            if analyzers and all(analyzer.is_complete for analyzer in analyzers):
                break

            # Polling is every 15s for tens of minutes; log only when the count moves,
            # so a run produces a handful of progress lines rather than hundreds.
            complete = sum(1 for analyzer in analyzers if analyzer.is_complete)
            if complete > done_count:
                done_count = complete
                logger.info(
                    "[%s] %d/%d analyzers done | %s",
                    tag,
                    complete,
                    len(analyzers),
                    _elapsed(started),
                )

            _write_status(
                db_video_id,
                index_status={
                    "step": "understanding",
                    "message": "Analyzing video…",
                    "segmentation": segmentation,
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

        failed = [analyzer for analyzer in analyzers if not analyzer.is_successful]
        if failed:
            logger.warning(
                "[%s] analyzers did not succeed: %s",
                tag,
                ", ".join(f"{analyzer.name}={analyzer.status}" for analyzer in failed),
            )
        logger.info(
            "[%s] understanding done in %s | %d/%d ok",
            tag,
            _elapsed(started),
            len(successful),
            len(analyzers),
        )

        if not successful:
            raise RuntimeError("Every analyzer failed — nothing to index")

        _write_status(
            db_video_id,
            index_status={
                "step": "indexing",
                "message": "Building search indexes…",
                "segmentation": segmentation,
                "analyzers": _analyzer_entries(understanding),
            },
        )

        # Re-indexing a video would otherwise collide with its own previous index —
        # the name is a schema contract, and a rebuilt artifact rarely has the exact
        # same shape. Dropping ours first makes the pipeline idempotent. Only this
        # video's indexes are touched; other videos in the collection are not ours.
        stale = {index.name: index for index in (video.list_indexes() or [])}

        built: list[dict[str, Any]] = []
        for analyzer in successful:
            name = index_name(analyzer.name)
            try:
                previous = stale.get(name)
                if previous is not None:
                    logger.info("[%s] replacing existing index %s", tag, name)
                    previous.delete()

                index = video.index(source=index_source(analyzer), name=name)
                if index is not None:
                    index.wait_until_complete(
                        timeout=settings.index_timeout_seconds,
                        poll_interval=settings.index_poll_seconds,
                    )
                    built.append(
                        {
                            "name": getattr(index, "name", name),
                            "status": getattr(index, "status", None),
                            "record_count": getattr(index, "record_count", None),
                        }
                    )
            except Exception as exc:  # noqa: BLE001 - one bad index shouldn't sink the rest
                logger.warning("[%s] index %s failed: %s", tag, name, exc)
                built.append({"name": name, "status": "failed", "error": str(exc)})

        logger.info(
            "[%s] indexed %s",
            tag,
            ", ".join(
                f"{entry['name']}"
                + (f"({entry['record_count']})" if entry.get("record_count") else "")
                + (f" [{entry['status']}]" if entry.get("status") != "ready" else "")
                for entry in built
            )
            or "nothing",
        )

        # v1 spoken-word index — `add_subtitle()` and `get_transcript_text()` read this,
        # and a v2 `transcript` artifact does not substitute for it.
        try:
            video.index_spoken_words(force=True)
        except Exception as exc:  # noqa: BLE001 - transcript is a bonus, not the point
            logger.warning("[%s] index_spoken_words failed: %s", tag, exc)

        if not any(entry.get("status") not in (None, "failed") for entry in built):
            raise RuntimeError("No index finished building")

        # Thumbnail, duration and stream URL are often unavailable at upload time
        # (notably for YouTube sources). Re-read them now that processing is done.
        try:
            refreshed = video_payload(get_video(videodb_video_id))
        except Exception:  # noqa: BLE001
            logger.debug("Could not refresh video metadata", exc_info=True)
            refreshed = {}

        _write_status(
            db_video_id,
            **{key: value for key, value in refreshed.items() if value},
            status="ready",
            error=None,
            index_status={
                "step": "ready",
                "message": "Ready to search",
                "segmentation": segmentation,
                "analyzers": _analyzer_entries(understanding),
                "indexes": built,
            },
        )
        logger.info("[%s] ready in %s", tag, _elapsed(started))

    except Exception as exc:  # noqa: BLE001
        # The traceback goes through `videodb`'s HTTP layer and says little about our
        # code, so only DEBUG carries it — the message is what identifies the problem.
        logger.error("[%s] pipeline failed after %s: %s", tag, _elapsed(started), exc)
        logger.debug("[%s] pipeline traceback", tag, exc_info=True)
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
