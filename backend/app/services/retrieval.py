"""Retrieval over indexed videos.

Project scope is a list of VideoDB video ids supplied by the caller, so every
multi-video method fans out over them in a thread pool and merges the results.
"""

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Iterable, TypeVar

from videodb.shot import Shot

from app.clients import get_connection, get_video
from app.schemas import ShotOut, TranscriptSegment
from app.services.ingest import player_url

logger = logging.getLogger(__name__)

MAX_WORKERS = 6

T = TypeVar("T")


def _fan_out(video_ids: Iterable[str], fn: Callable[[str], T]) -> tuple[list[T], list[str]]:
    """Run `fn` per video id. Returns (results, errors) — one failure never blocks the rest."""
    ids = list(dict.fromkeys(video_ids))
    results: list[T] = []
    errors: list[str] = []
    if not ids:
        return results, errors

    def safe(video_id: str) -> tuple[str, T | None, str | None]:
        try:
            return video_id, fn(video_id), None
        except Exception as exc:  # noqa: BLE001
            logger.warning("Retrieval failed for %s: %s", video_id, exc)
            return video_id, None, str(exc)

    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(ids))) as pool:
        for video_id, value, error in pool.map(safe, ids):
            if error:
                errors.append(f"{video_id}: {error}")
            elif value is not None:
                results.append(value)
    return results, errors


def _shot_out(shot: Shot, *, with_stream: bool = True) -> ShotOut:
    stream_url = shot.stream_url
    if with_stream and not stream_url:
        try:
            stream_url = shot.generate_stream()
        except Exception:  # noqa: BLE001 - a missing clip URL is not fatal
            logger.debug("generate_stream failed for shot in %s", shot.video_id, exc_info=True)

    return ShotOut(
        video_id=shot.video_id,
        video_title=shot.video_title,
        start=float(shot.start or 0),
        end=float(shot.end or 0),
        text=shot.text,
        score=float(shot.search_score) if shot.search_score is not None else None,
        stream_url=stream_url,
        player_url=shot.player_url or player_url(stream_url),
        metadata=shot.metadata,
    )


def _rank(shots: list[ShotOut], top_k: int) -> list[ShotOut]:
    return sorted(shots, key=lambda shot: shot.score or 0, reverse=True)[:top_k]


def search_moments(
    video_ids: list[str],
    query: str,
    top_k: int = 8,
    return_fields: Any = None,
) -> tuple[list[ShotOut], str | None, list[str]]:
    """Natural-language search. VideoDB plans the retrieval and picks the indexes."""

    def run(video_id: str) -> list[ShotOut]:
        video = get_video(video_id)
        kwargs: dict[str, Any] = {"top_k": top_k}
        if return_fields is not None:
            kwargs["return_fields"] = return_fields
        response = video.search(query, **kwargs)
        # An analytical query can come back as `aggregate`, which carries no shots.
        if getattr(response, "response_type", None) not in ("shots", "deepsearch"):
            return []
        return [_shot_out(shot, with_stream=False) for shot in response.shots]

    per_video, errors = _fan_out(video_ids, run)
    shots = _rank([shot for group in per_video for shot in group], top_k)

    compiled = None
    if shots:
        try:
            compiled = compile_shots(shots)
        except Exception:  # noqa: BLE001
            logger.debug("Compiling merged stream failed", exc_info=True)

    # Hydrate per-shot streams only for what we return, so the panel can play them.
    hydrate_streams(shots)
    return shots, compiled, errors


def hydrate_streams(shots: list[ShotOut]) -> None:
    """Fill in a playable stream URL per shot, in parallel. Mutates in place."""
    missing = [shot for shot in shots if not shot.stream_url]
    if not missing:
        return

    def fill(shot: ShotOut) -> None:
        try:
            stream = compile_clip(shot.video_id, [(shot.start, shot.end)])
            shot.stream_url = stream
            shot.player_url = player_url(stream)
        except Exception:  # noqa: BLE001 - a missing clip URL is not fatal
            logger.debug("Per-shot stream failed for %s", shot.video_id, exc_info=True)

    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(missing))) as pool:
        list(pool.map(fill, missing))


def compile_shots(shots: list[ShotOut]) -> str | None:
    """Concatenate moments — across videos — into a single playable stream."""
    if not shots:
        return None
    payload = [
        {"video_id": shot.video_id, "shots": [(shot.start, shot.end)]}
        for shot in shots
        if shot.end > shot.start
    ]
    if not payload:
        return None
    data = get_connection().post(path="compile", data=payload) or {}
    return data.get("stream_url")


def ask_videos(
    video_ids: list[str], question: str, top_k: int = 12
) -> tuple[str, list[ShotOut], list[str]]:
    """Grounded answer plus the moments it came from."""

    def run(video_id: str) -> tuple[str, list[ShotOut]]:
        video = get_video(video_id)
        response = video.ask(question, top_k=top_k, include_sources=True)
        title = getattr(video, "name", None) or video_id
        sources = [_shot_out(shot, with_stream=False) for shot in response.sources]
        answer = (response.answer or "").strip()
        return (f"**{title}**\n{answer}" if answer else "", sources)

    per_video, errors = _fan_out(video_ids, run)
    answers = [answer for answer, _ in per_video if answer]
    sources = _rank([shot for _, group in per_video for shot in group], top_k)

    if len(video_ids) == 1 and answers:
        # Single video — no need for the title heading the agent didn't ask for.
        answers = [answers[0].split("\n", 1)[-1]]

    return "\n\n".join(answers), sources, errors


def semantic_search(
    video_ids: list[str],
    query: str,
    index_names: list[str] | None = None,
    top_k: int = 8,
    score_threshold: float | None = None,
) -> tuple[list[ShotOut], list[str]]:
    def run(video_id: str) -> list[ShotOut]:
        video = get_video(video_id)
        result = video.semantic_search(
            query=query,
            index_names=index_names,
            top_k=top_k,
            score_threshold=score_threshold,
        )
        return [_shot_out(shot, with_stream=False) for shot in result.get_shots()]

    per_video, errors = _fan_out(video_ids, run)
    return _rank([shot for group in per_video for shot in group], top_k), errors


def query_index(
    video_id: str,
    index_name: str,
    filter: Any = None,
    limit: int = 50,
    sort: list[tuple[str, str]] | None = None,
    return_fields: Any = None,
) -> list[ShotOut]:
    video = get_video(video_id)
    kwargs: dict[str, Any] = {
        "index_name": index_name,
        "filter": filter,
        "limit": limit,
        "sort": sort,
    }
    # Nested objects and lists (setting, visible_objects) live outside the searchable
    # groups — `return_fields` is the only way to read them back off a shot.
    if return_fields is not None:
        kwargs["return_fields"] = return_fields
    result = video.query(**kwargs)
    return [_shot_out(shot, with_stream=False) for shot in result.get_shots()]


def aggregate_index(
    video_id: str,
    index_name: str,
    group_by: str | None = None,
    metric: str = "count",
    filter: Any = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    video = get_video(video_id)
    payload = video.aggregate(
        index_name=index_name,
        group_by=group_by,
        metric=metric,
        filter=filter,
        limit=limit,
    )
    # The server payload is returned as-is: an envelope dict or a bare list.
    if isinstance(payload, dict):
        rows = payload.get("results", [])
    else:
        rows = payload or []
    return [row for row in rows if isinstance(row, dict)]


def compile_clip(video_id: str, timestamps: list[tuple[float, float]]) -> str:
    """Stitch timestamp ranges into one playable HLS stream."""
    ranges = [(max(0.0, float(start)), float(end)) for start, end in timestamps if end > start]
    if not ranges:
        raise ValueError("At least one valid (start, end) range is required")
    return get_video(video_id).generate_stream(timeline=ranges)


SEGMENTERS = ("sentence", "word", "time")


def get_transcript(
    video_id: str,
    start: float | None = None,
    end: float | None = None,
    segmenter: str = "sentence",
    length: int = 1,
) -> tuple[list[TranscriptSegment], str]:
    """Timestamped transcript segments plus the flat text they add up to.

    Sentences are the default segmenter — word-level segments are too fine to cite
    against, and the flat text loses the timestamps entirely.
    """
    if segmenter not in SEGMENTERS:
        raise ValueError(f"segmenter must be one of {', '.join(SEGMENTERS)}")

    video = get_video(video_id)
    kwargs: dict[str, Any] = {"segmenter": segmenter, "length": length}
    if start is not None:
        kwargs["start"] = int(start)
    if end is not None:
        kwargs["end"] = int(end)

    rows = video.get_transcript(**kwargs) or []
    segments = [
        TranscriptSegment(
            start=float(row.get("start") or 0),
            end=float(row.get("end") or 0),
            text=text,
        )
        for row in rows
        if (text := (row.get("text") or "").strip()) and text != "-"
    ]
    # The same response carries the flat text; fall back to stitching the segments.
    text = (getattr(video, "transcript_text", "") or "").strip()
    return segments, text or " ".join(segment.text for segment in segments)
