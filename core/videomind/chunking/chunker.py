import numpy as np

from .. import audio_extract
from ..boundaries import diarization, scenes, semantic, vad

WEIGHTS = {
    "audio": {"speaker": 0.35, "silence": 0.35, "cut": 0.15, "semantic": 0.15},
    "video": {"speaker": 0.15, "silence": 0.15, "cut": 0.35, "semantic": 0.35},
    "audio_video": {"speaker": 0.25, "silence": 0.25, "cut": 0.25, "semantic": 0.25},
}

BoundaryEvents = dict[str, list[tuple[float, float]]]
Chunks = list[tuple[float, float]]


def collect_boundaries(video_path: str) -> tuple[BoundaryEvents, float]:
    """Run all 4 detectors once and return their raw (time, strength) events."""
    waveform, sample_rate = audio_extract.extract_audio(video_path)
    duration = len(waveform) / sample_rate

    annotation = diarization.diarize(waveform, sample_rate)
    speaker_events = diarization.speaker_change_boundaries(annotation)

    speech_segments = vad.detect_speech(waveform, sample_rate)
    silence_events = vad.silence_boundaries(speech_segments, duration)

    scene_list = scenes.detect_cuts(video_path)
    cut_events = scenes.cut_boundaries(scene_list)

    embeddings = semantic.frame_embeddings(video_path)
    semantic_events = semantic.semantic_boundaries(embeddings)

    events = {
        "speaker": speaker_events,
        "silence": silence_events,
        "cut": cut_events,
        "semantic": semantic_events,
    }
    return events, duration


def fuse(
    events: BoundaryEvents,
    weights: dict[str, float],
    duration: float,
    sigma: float = 1.0,
    resolution: float = 0.1,
    min_gap: float = 2.0,
    threshold: float = 0.12,
) -> list[float]:
    """Combine weighted boundary events into a single set of cut timestamps.

    Each event contributes a Gaussian bump (width `sigma`) of height
    weight * strength to a score curve over the whole clip, so boundaries
    agreed on by multiple sources reinforce each other. Peaks are then
    picked greedily, strongest first, enforcing `min_gap` between accepted
    boundaries so we don't produce back-to-back tiny chunks.
    """
    active = {source for source, source_events in events.items() if source_events}
    total = sum(weights.get(source, 0.0) for source in active)
    if total > 0:
        weights = {source: weights.get(source, 0.0) / total for source in active}

    grid = np.arange(0, duration + resolution, resolution)
    score = np.zeros_like(grid)

    for source, source_events in events.items():
        weight = weights.get(source, 0.0)
        if weight == 0.0:
            continue
        for t, strength in source_events:
            score += weight * strength * np.exp(-((grid - t) ** 2) / (2 * sigma ** 2))

    accepted: list[float] = []
    for idx in np.argsort(score)[::-1]:
        if score[idx] < threshold:
            break
        t = grid[idx]
        if all(abs(t - a) >= min_gap for a in accepted):
            accepted.append(float(t))

    return sorted(accepted)


def boundaries_to_chunks(boundaries: list[float], duration: float) -> Chunks:
    points = [0.0, *boundaries, duration]
    return list(zip(points[:-1], points[1:]))


def audio_chunk(video_path: str, **fuse_kwargs) -> Chunks:
    """Chunk primarily on speaker changes and silence, lightly on cuts/semantic shifts."""
    events, duration = collect_boundaries(video_path)
    boundaries = fuse(events, WEIGHTS["audio"], duration, **fuse_kwargs)
    return boundaries_to_chunks(boundaries, duration)


def video_chunk(video_path: str, **fuse_kwargs) -> Chunks:
    """Chunk primarily on hard cuts and semantic shifts, lightly on speech signals."""
    events, duration = collect_boundaries(video_path)
    boundaries = fuse(events, WEIGHTS["video"], duration, **fuse_kwargs)
    return boundaries_to_chunks(boundaries, duration)


def audio_video_chunk(video_path: str, **fuse_kwargs) -> Chunks:
    """Chunk using all four signals, equally weighted."""
    events, duration = collect_boundaries(video_path)
    boundaries = fuse(events, WEIGHTS["audio_video"], duration, **fuse_kwargs)
    return boundaries_to_chunks(boundaries, duration)
