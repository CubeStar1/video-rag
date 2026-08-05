from ..boundaries import diarization as pyannote
from ..extractors.audio import transcript as whisper
from .base import Chunks, VideoContext


def _speaker_turns(annotation) -> list[tuple[float, float, str]]:
    """(start, end, speaker) for the whole video, in time order."""
    return sorted(
        (turn.start, turn.end, speaker)
        for turn, _, speaker in annotation.itertracks(yield_label=True)
    )


def _assign_speaker(seg_start: float, seg_end: float, turns) -> str | None:
    """The speaker whose turn overlaps this speech segment most.

    Whisper's segments and pyannote's turns are cut on different criteria and
    rarely line up exactly, so pick by largest overlap rather than requiring
    containment.
    """
    best, best_overlap = None, 0.0
    for turn_start, turn_end, speaker in turns:
        overlap = min(seg_end, turn_end) - max(seg_start, turn_start)
        if overlap > best_overlap:
            best, best_overlap = speaker, overlap
    return best


class DiarizationAnalyzer:
    """Who said what: speaker-attributed transcript per chunk."""

    id = "diarization"

    def __init__(self, model_size: str = "tiny", language: str | None = None):
        self.model_size = model_size
        self.language = language

    def analyze(self, chunks: Chunks, ctx: VideoContext) -> list[dict]:
        waveform, sample_rate = ctx.audio()

        # Diarize the whole track once, not per chunk: speaker labels are only
        # consistent across the video if they come from a single pass, and
        # a chunk-local pass would call the same person SPEAKER_00 in one chunk
        # and SPEAKER_01 in the next. Memoised so another speaker-aware
        # analyzer can reuse it.
        annotation = ctx.memo("diarization", lambda: pyannote.diarize(waveform, sample_rate))
        turns = _speaker_turns(annotation)

        language = self.language or ctx.memo(
            "language", lambda: whisper.detect_language(waveform, sample_rate, self.model_size)
        )

        results: list[dict | None] = []
        for start, end in chunks:
            segments = whisper.transcribe_segments(
                waveform, sample_rate, start, end,
                model_size=self.model_size, language=language,
            )
            if not segments:
                results.append(None)
                continue

            # Merge consecutive segments from the same speaker into one turn.
            merged: list[dict] = []
            for seg_start, seg_end, text in segments:
                speaker = _assign_speaker(seg_start, seg_end, turns) or "UNKNOWN"
                if merged and merged[-1]["speaker"] == speaker:
                    merged[-1]["end"] = round(seg_end, 3)
                    merged[-1]["text"] += " " + text
                else:
                    merged.append({
                        "speaker": speaker,
                        "start": round(seg_start, 3),
                        "end": round(seg_end, 3),
                        "text": text,
                    })

            results.append({
                "text": "\n".join(f"{t['speaker']}: {t['text']}" for t in merged),
                "plain": " ".join(t["text"] for t in merged),
                "turns": merged,
                "speakers": sorted({t["speaker"] for t in merged}),
            })

        return results

    def render_fields(self, output: dict) -> dict[str, str]:
        if not output:
            return {}
        # Embed the speech without the "SPEAKER_00:" prefixes. The labels are
        # for display and filtering; inside the vector they are just repeated
        # tokens carrying no meaning, diluting the words that do.
        plain = (output.get("plain") or "").strip()
        return {"combined": plain} if plain else {}
