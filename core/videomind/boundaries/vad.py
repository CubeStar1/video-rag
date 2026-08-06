import numpy as np
import torch
from silero_vad import get_speech_timestamps, load_silero_vad

_model = None


def _get_model():
    global _model
    if _model is None:
        _model = load_silero_vad()
    return _model


def detect_speech(waveform: np.ndarray, sample_rate: int) -> list[dict]:
    """Return speech segments as a list of {"start": s, "end": s} dicts, in seconds."""
    if len(waveform) == 0:
        return []

    wav = torch.from_numpy(waveform) if isinstance(waveform, np.ndarray) else waveform
    model = _get_model()
    return get_speech_timestamps(wav, model, sampling_rate=sample_rate, return_seconds=True)


def silence_boundaries(
    speech_segments: list[dict],
    duration: float,
    saturate_at: float = 2.0,
) -> list[tuple[float, float]]:
    """Boundary at the midpoint of each silence gap between speech segments.

    Strength scales with gap length, saturating at 1.0 once a gap reaches
    `saturate_at` seconds (long silences are stronger chunk-boundary signals
    than brief pauses between words).
    """
    boundaries = []
    cursor = 0.0

    for seg in speech_segments:
        gap = seg["start"] - cursor
        if gap > 0.05:
            midpoint = (cursor + seg["start"]) / 2
            boundaries.append((midpoint, min(1.0, gap / saturate_at)))
        cursor = seg["end"]

    trailing_gap = duration - cursor
    if trailing_gap > 0.05:
        midpoint = (cursor + duration) / 2
        boundaries.append((midpoint, min(1.0, trailing_gap / saturate_at)))

    return boundaries
