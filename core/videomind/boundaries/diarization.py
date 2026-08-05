import os

import numpy as np
import torch
from dotenv import load_dotenv
from pyannote.audio import Pipeline
from pyannote.core import Annotation

load_dotenv()

_pipeline = None


def _get_pipeline() -> Pipeline:
    global _pipeline
    if _pipeline is None:
        _pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-community-1",
            token=os.environ["HF_TOKEN"],
        )
        if torch.cuda.is_available():
            _pipeline.to(torch.device("cuda"))
    return _pipeline


def diarize(waveform: np.ndarray, sample_rate: int) -> Annotation:
    """Run speaker diarization on a mono waveform, return a pyannote Annotation."""
    wav = torch.from_numpy(waveform) if isinstance(waveform, np.ndarray) else waveform
    if wav.ndim == 1:
        wav = wav.unsqueeze(0)

    pipeline = _get_pipeline()
    output = pipeline({"waveform": wav, "sample_rate": sample_rate})
    return output.speaker_diarization


def speaker_change_boundaries(annotation: Annotation) -> list[tuple[float, float]]:
    """Boundary at each point where the active speaker changes.

    Returns (time, strength) pairs; strength is always 1.0 since a
    detected speaker change is a binary, high-confidence signal.
    """
    turns = sorted(annotation.itertracks(yield_label=True), key=lambda t: t[0].start)

    boundaries = []
    for (prev_turn, _, prev_speaker), (curr_turn, _, curr_speaker) in zip(turns, turns[1:]):
        if curr_speaker != prev_speaker:
            midpoint = (prev_turn.end + curr_turn.start) / 2
            boundaries.append((midpoint, 1.0))
    return boundaries
