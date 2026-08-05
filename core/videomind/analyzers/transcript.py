from ..extractors.audio import transcript as whisper
from .base import Chunks, VideoContext


class TranscriptAnalyzer:
    """Speech transcription per chunk. Needs only audio, never touches frames."""

    id = "transcript"

    def __init__(self, model_size: str = "tiny", language: str | None = None):
        self.model_size = model_size
        self.language = language

    def analyze(self, chunks: Chunks, ctx: VideoContext) -> list[str]:
        waveform, sample_rate = ctx.audio()

        # Detect language once over the whole track: Whisper re-detects per
        # segment, and on a short or noisy span it picks the wrong one and
        # emits fluent gibberish in it.
        language = self.language or whisper.detect_language(waveform, sample_rate, self.model_size)

        return [
            whisper.transcribe_segment(
                waveform, sample_rate, start, end,
                model_size=self.model_size, language=language,
            )
            for start, end in chunks
        ]

    def render_fields(self, output: str) -> dict[str, str]:
        text = (output or "").strip()
        return {"combined": text} if text else {}
