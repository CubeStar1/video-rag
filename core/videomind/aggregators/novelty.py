import numpy as np

from ..vectordb.store import COLLECTION
from .base import AggregateContext


class NoveltyAggregator:
    """Which chunks are least like the rest of the video.

    Reuses the vectors already in the store - no model runs, no API calls.
    For surveillance this is often the whole question ("show me the unusual
    bit"), and it gives an agent a ranked place to start instead of guessing
    search terms blind.
    """

    id = "novelty"
    depends_on = ()

    def __init__(self, analyzer_preference: tuple[str, ...] = (
        "default_video", "people", "object_detection", "ocr", "diarization", "transcript",
    )):
        # Whichever of these the video has, in this order: scene-level output
        # describes a moment better than a transcript does.
        self.analyzer_preference = analyzer_preference

    def aggregate(self, ctx: AggregateContext) -> dict | None:
        if ctx.store is None:
            return None
        available = ctx.record.get("analyzers", [])
        analyzer_id = next((a for a in self.analyzer_preference if a in available), None)
        if analyzer_id is None:
            return None

        points, _ = ctx.store.client.scroll(
            COLLECTION, limit=10_000, with_payload=True, with_vectors=True
        )
        selected = [
            p for p in points
            if p.payload.get("video_id") == ctx.video_id
            and p.payload.get("extractor_id") == analyzer_id
        ]
        if len(selected) < 3:
            return None  # too few chunks for "unlike the rest" to mean anything

        vectors = np.array([p.vector["combined"] for p in selected])
        centroid = vectors.mean(axis=0)
        centroid /= np.linalg.norm(centroid) or 1.0
        distances = 1.0 - (vectors @ centroid)

        ranked = sorted(
            (
                {
                    "chunk_id": p.payload["chunk_id"],
                    "start": p.payload["start"],
                    "end": p.payload["end"],
                    "novelty": round(float(d), 4),
                    "description": (p.payload.get("description") or "")[:200],
                }
                for p, d in zip(selected, distances)
            ),
            key=lambda r: -r["novelty"],
        )

        mean, std = float(distances.mean()), float(distances.std())
        return {
            "basis": analyzer_id,
            "mean_distance": round(mean, 4),
            "ranked": ranked,
            # Two sigma from the mean, so "unusual" scales with how varied this
            # particular video is rather than using a threshold tuned on one clip.
            "outliers": [r for r in ranked if r["novelty"] > mean + 2 * std],
        }
