"""Analyzer registry.

To add an analyzer: write a module exposing `id`, `analyze(chunks, ctx)` and
`render_fields(output)`, then register it here. Nothing in ingest, the vector
store or the API needs to change.
"""

from .base import Analyzer, VideoContext
from .diarization import DiarizationAnalyzer
from .objects import ObjectAnalyzer
from .ocr import OCRAnalyzer
from .people import PeopleAnalyzer
from .scene import SceneAnalyzer
from .transcript import TranscriptAnalyzer

REGISTRY: dict[str, Analyzer] = {
    a.id: a for a in (
        SceneAnalyzer(), TranscriptAnalyzer(), DiarizationAnalyzer(),
        OCRAnalyzer(), ObjectAnalyzer(), PeopleAnalyzer(),
    )
}


# Analyzers that must not be run together. `diarization` is a strict superset
# of `transcript`: both embed the same Whisper text (their vectors come out
# cosine-identical), and diarization adds speaker attribution on top. Running
# both doubles storage and query cost for no retrieval gain.
EXCLUSIVE_GROUPS: tuple[frozenset[str], ...] = (
    frozenset({"transcript", "diarization"}),
)


def get(analyzer_id: str) -> Analyzer:
    if analyzer_id not in REGISTRY:
        raise KeyError(f"Unknown analyzer {analyzer_id!r}; registered: {sorted(REGISTRY)}")
    return REGISTRY[analyzer_id]


def validate_selection(analyzer_ids) -> None:
    """Raise if a selection is unknown or mixes mutually exclusive analyzers."""
    unknown = [a for a in analyzer_ids if a not in REGISTRY]
    if unknown:
        raise ValueError(f"Unknown analyzer(s) {unknown}; registered: {sorted(REGISTRY)}")

    chosen = set(analyzer_ids)
    for group in EXCLUSIVE_GROUPS:
        clash = sorted(chosen & group)
        if len(clash) > 1:
            raise ValueError(
                f"Analyzers {clash} are mutually exclusive - pick one. "
                f"'diarization' produces the same transcript text as 'transcript', "
                f"plus speaker attribution."
            )


def available() -> list[str]:
    return sorted(REGISTRY)


__all__ = ["Analyzer", "VideoContext", "REGISTRY", "get", "available",
           "validate_selection", "EXCLUSIVE_GROUPS",
           "SceneAnalyzer", "TranscriptAnalyzer", "DiarizationAnalyzer", "OCRAnalyzer", "ObjectAnalyzer", "PeopleAnalyzer"]
