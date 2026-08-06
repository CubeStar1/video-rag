from typing import Any, Protocol, runtime_checkable

import numpy as np

from .. import audio_extract, poster
from ..extractors.video import frames as frame_reader

Chunks = list[tuple[float, float]]


class VideoContext:
    """Shared decode primitives for one video.

    Deliberately provides *capabilities*, not pre-sampled frames: every
    analyzer owns its own sampling technique, so one may want 2fps across a
    whole chunk while another samples only where some condition holds. This
    hands out a cached reader they can pull from however they like, so
    overlapping requests do not re-decode while nothing is decided for them.
    """

    def __init__(self, video_path: str):
        self.video_path = video_path
        self._audio: tuple[np.ndarray, int] | None = None
        self._frames: dict[tuple[float, float, float], tuple[list[float], list[np.ndarray]]] = {}
        self._memo: dict[str, Any] = {}

    def memo(self, key: str, factory):
        """Cache an expensive per-video result under `key`, computing it once.

        Lets analyzers share heavy work (speaker diarization, say) without this
        class needing to know what any of them do.
        """
        if key not in self._memo:
            self._memo[key] = factory()
        return self._memo[key]

    def audio(self) -> tuple[np.ndarray, int]:
        """Mono waveform + sample rate, decoded once per video."""
        if self._audio is None:
            self._audio = audio_extract.extract_audio(self.video_path)
        return self._audio

    def frames(self, start: float, end: float, fps: float = 2.0):
        """Frames in [start, end) at `fps`, cached by request signature."""
        key = (round(start, 3), round(end, 3), fps)
        if key not in self._frames:
            self._frames[key] = frame_reader.read_frames(self.video_path, start, end, fps=fps)
        return self._frames[key]

    def duration(self) -> float:
        """From the container, so a video with no audio track still has a length."""
        duration = poster.duration_of(self.video_path)
        if duration > 0:
            return duration
        waveform, sample_rate = self.audio()
        return len(waveform) / sample_rate


@runtime_checkable
class Analyzer(Protocol):
    """One analysis pass over a video's chunks.

    An analyzer bundles its own sampling technique, prompt and output shape,
    so adding a new one never requires touching ingest, the vector store or
    the API - only registering it.
    """

    id: str

    def analyze(self, chunks: Chunks, ctx: VideoContext) -> list[Any]:
        """Produce one output per chunk (None/'' for chunks with nothing to say)."""
        ...

    def render_fields(self, output: Any) -> dict[str, str]:
        """Flatten one output into {named_vector: text}. Must include 'combined'."""
        ...
