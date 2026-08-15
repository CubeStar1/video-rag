from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable


@dataclass
class AggregateContext:
    """What an aggregator gets to work with.

    Aggregators run after analyzers and read their saved output, so they never
    touch the video itself unless they explicitly need pixels (entity linking
    cropping people, say). That makes them cheap enough to re-run without
    re-analysing.
    """

    record: dict
    results: dict[str, Any] = field(default_factory=dict)
    store: Any = None

    @property
    def video_path(self) -> str:
        """A local copy of the video, fetched from Storage on first access.

        Resolved lazily and not in the constructor: no aggregator currently
        opens the video, and re-running the twelve of them on a cold cache
        should not pay for a download that nothing reads. The property is kept
        so one that does need pixels still has a path to work with.
        """
        from .. import storage

        return storage.local_path_for(self.video_id, self.record.get("storage_path"))

    def chunks(self, analyzer_id: str | None = None) -> list[dict]:
        """Chunks, optionally only those with a given analyzer's output."""
        chunks = self.record.get("chunks", [])
        if analyzer_id is None:
            return chunks
        return [c for c in chunks if c.get(analyzer_id)]

    def has(self, analyzer_id: str) -> bool:
        return analyzer_id in self.record.get("analyzers", [])

    @property
    def video_id(self) -> str:
        return self.record.get("video_id", "")

    @property
    def duration(self) -> float:
        chunks = self.record.get("chunks", [])
        return chunks[-1]["end"] if chunks else 0.0


@runtime_checkable
class Aggregator(Protocol):
    """One video-level pass over analyzer output.

    Unlike an Analyzer, which returns one result per chunk, an Aggregator
    returns a single result for the whole video - summaries, statistics,
    entities. `depends_on` names the analyzers (or other aggregators) whose
    output it reads, which decides both run order and whether it can run at all.
    """

    id: str
    depends_on: tuple[str, ...]

    def aggregate(self, ctx: AggregateContext) -> dict | None:
        """Produce the video-level result, or None when inputs are missing."""
        ...
