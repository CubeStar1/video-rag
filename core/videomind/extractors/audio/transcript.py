import numpy as np
import torch
from faster_whisper import WhisperModel

from ... import audio_extract

_model = None
_model_size = None


def _get_model(model_size: str) -> WhisperModel:
    global _model, _model_size
    if _model is None or _model_size != model_size:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        compute_type = "float16" if device == "cuda" else "int8"
        _model = WhisperModel(model_size, device=device, compute_type=compute_type)
        _model_size = model_size
    return _model


def transcribe_segment(
    waveform: np.ndarray,
    sample_rate: int,
    start: float,
    end: float,
    model_size: str = "tiny",
    language: str | None = None,
) -> str:
    """Transcribe one time range of an already-extracted waveform.

    Pass `language` (e.g. "en") when the whole video is known to be one
    language: Whisper re-detects per segment, and on a short or noisy span it
    can pick the wrong one and emit fluent gibberish in it.
    """
    segment = waveform[int(start * sample_rate) : int(end * sample_rate)]
    if segment.size == 0:
        return ""

    model = _get_model(model_size)
    # vad_filter drops non-speech audio before decoding. Without it Whisper
    # invents plausible-sounding dialogue out of ambient noise (engine hum,
    # music, room tone) rather than returning nothing.
    segments, _info = model.transcribe(
        segment, beam_size=5, vad_filter=True, language=language
    )
    return " ".join(s.text.strip() for s in segments).strip()


def transcribe_segments(
    waveform: np.ndarray,
    sample_rate: int,
    start: float,
    end: float,
    model_size: str = "tiny",
    language: str | None = None,
) -> list[tuple[float, float, str]]:
    """Transcribe a range and keep Whisper's own segment boundaries.

    Returns (start, end, text) in absolute video time - Whisper reports times
    relative to the slice it was given, so the offset is added back here.
    Needed to line speech up against speaker turns.
    """
    segment = waveform[int(start * sample_rate) : int(end * sample_rate)]
    if segment.size == 0:
        return []

    model = _get_model(model_size)
    segments, _info = model.transcribe(
        segment, beam_size=5, vad_filter=True, language=language
    )
    return [
        (start + s.start, start + s.end, s.text.strip())
        for s in segments
        if s.text.strip()
    ]


def detect_language(waveform: np.ndarray, sample_rate: int, model_size: str = "tiny") -> str | None:
    """Detect the language once over the whole audio."""
    model = _get_model(model_size)
    _segments, info = model.transcribe(waveform, beam_size=1, vad_filter=True)
    return info.language


def transcribe_chunks(
    video_path: str,
    chunks: list[tuple[float, float]],
    model_size: str = "tiny",
    language: str | None = None,
) -> list[str]:
    """Transcribe every chunk of a video. Audio is decoded once and sliced per chunk.

    Language is detected once across the whole track and pinned for every
    chunk, rather than re-detected per chunk where a short noisy span can be
    misidentified and decoded into fluent nonsense.
    """
    waveform, sample_rate = audio_extract.extract_audio(video_path)
    if language is None:
        language = detect_language(waveform, sample_rate, model_size)
    return [
        transcribe_segment(waveform, sample_rate, start, end, model_size=model_size, language=language)
        for start, end in chunks
    ]
