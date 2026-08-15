import math

import numpy as np

from . import poster
from .chunking import WEIGHTS, boundaries_to_chunks, collect_boundaries, fuse

SIGNALS = ("speaker", "silence", "cut", "semantic")

Chunks = list[tuple[float, float]]


def _video_duration(video_path: str) -> float:
    """Container duration, or a clear error rather than silently zero chunks."""
    duration = poster.duration_of(video_path)
    if duration <= 0:
        raise ValueError(f"Could not determine a duration for {video_path}")
    return duration


def _split_long_chunks(chunks: Chunks, max_duration: float) -> Chunks:
    """Evenly split any chunk longer than max_duration into equal pieces,
    each no longer than max_duration (avoids a tiny leftover trailing piece)."""
    result = []
    for start, end in chunks:
        duration = end - start
        if duration <= max_duration:
            result.append((start, end))
            continue
        n_parts = math.ceil(duration / max_duration)
        part_len = duration / n_parts
        result.extend((start + i * part_len, start + (i + 1) * part_len) for i in range(n_parts))
    return result


def _merge_short_chunks(chunks: Chunks, min_duration: float) -> Chunks:
    """Merge consecutive chunks forward until each is at least min_duration,
    folding a short leftover at the end into the last merged chunk."""
    if not chunks:
        return chunks

    merged = []
    group_start, group_end = chunks[0]
    for start, end in chunks[1:]:
        if group_end - group_start < min_duration:
            group_end = end
        else:
            merged.append((group_start, group_end))
            group_start, group_end = start, end

    if merged and group_end - group_start < min_duration:
        last_start, _ = merged[-1]
        merged[-1] = (last_start, group_end)
    else:
        merged.append((group_start, group_end))

    return merged


def chunk_video(
    video_path: str,
    preset: str | None = None,
    min_duration: float = 2.0,
    max_duration: float = 30.0,
    weights: dict[str, float] | None = None,
    interval: float | None = None,
) -> Chunks:
    """Split a video into chunks. Three mutually exclusive modes:

    - `interval=N`: cut every N seconds, no detectors, no min/max applied -
      the caller asked for exact spans, so they get exactly those.
    - `weights={...}`: custom weighting of the four boundary signals
      (speaker/silence/cut/semantic), then min/max enforced.
    - `preset=...`: a named weighting from chunking.WEIGHTS, then min/max
      enforced.

    For the two weighted modes, chunks longer than max_duration are split
    evenly and chunks shorter than min_duration are merged into a neighbour.
    """
    if interval is not None:
        if interval <= 0:
            raise ValueError(f"interval must be > 0, got {interval}")
        duration = _video_duration(video_path)
        edges = list(np.arange(0.0, duration, interval)) + [duration]
        return [(float(a), float(b)) for a, b in zip(edges[:-1], edges[1:]) if b > a]

    if min_duration > max_duration:
        raise ValueError(f"min_duration ({min_duration}) must be <= max_duration ({max_duration})")

    if weights is not None:
        unknown = set(weights) - set(SIGNALS)
        if unknown:
            raise ValueError(f"Unknown signal(s) {sorted(unknown)}; expected {list(SIGNALS)}")
        active = {signal: float(weights.get(signal, 0.0)) for signal in SIGNALS}
        if sum(active.values()) <= 0:
            raise ValueError("weights must include at least one signal above zero")
    elif preset in WEIGHTS:
        active = WEIGHTS[preset]
    else:
        raise ValueError(
            f"Unknown preset {preset!r}; expected one of {list(WEIGHTS)}, "
            f"or pass weights=... or interval=..."
        )

    events, duration = collect_boundaries(video_path)
    chunks = boundaries_to_chunks(fuse(events, active, duration), duration)
    chunks = _split_long_chunks(chunks, max_duration)
    chunks = _merge_short_chunks(chunks, min_duration)
    return chunks
