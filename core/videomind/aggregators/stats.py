import numpy as np

from .base import AggregateContext


def _series(chunks, key, getter):
    points = []
    for chunk in chunks:
        value = getter(chunk)
        if value is not None:
            points.append({"start": chunk["start"], "end": chunk["end"], key: value})
    return points


class StatsAggregator:
    """Counts and densities over time.

    Pure arithmetic on values the analyzers already produced. Exists because
    embeddings cannot count: "the busiest moment" or "when was nobody around"
    are exact questions that semantic search answers badly and a numeric
    series answers precisely.
    """

    id = "stats"
    depends_on = ()  # uses whatever analyzers happen to be present

    def aggregate(self, ctx: AggregateContext) -> dict | None:
        chunks = ctx.chunks()
        if not chunks:
            return None

        out: dict = {
            "duration": round(ctx.duration, 2),
            "chunks": len(chunks),
            "analyzers": ctx.record.get("analyzers", []),
        }

        if ctx.has("people"):
            people = _series(chunks, "people_count",
                             lambda c: (c.get("people") or {}).get("people_count"))
            counts = [p["people_count"] for p in people]
            if counts:
                busiest = max(people, key=lambda p: p["people_count"])
                quietest = min(people, key=lambda p: p["people_count"])
                out["people"] = {
                    "series": people,
                    "min": int(np.min(counts)),
                    "max": int(np.max(counts)),
                    "mean": round(float(np.mean(counts)), 2),
                    "total_observations": int(np.sum(counts)),
                    "busiest": {"start": busiest["start"], "end": busiest["end"],
                                "count": busiest["people_count"]},
                    "quietest": {"start": quietest["start"], "end": quietest["end"],
                                 "count": quietest["people_count"]},
                }

        if ctx.has("object_detection"):
            names: dict[str, int] = {}
            for chunk in ctx.chunks("object_detection"):
                for name in chunk["object_detection"].get("objects", []):
                    names[name] = names.get(name, 0) + 1
            if names:
                out["objects"] = {
                    "distinct": len(names),
                    "most_common": sorted(names.items(), key=lambda kv: -kv[1])[:15],
                }

        for analyzer_id in ("diarization", "transcript"):
            if not ctx.has(analyzer_id):
                continue
            spoken = 0.0
            words = 0
            for chunk in ctx.chunks(analyzer_id):
                output = chunk[analyzer_id]
                if isinstance(output, dict):
                    for turn in output.get("turns", []):
                        spoken += turn["end"] - turn["start"]
                        words += len(turn.get("text", "").split())
                else:
                    words += len(str(output).split())
            out["speech"] = {
                "chunks_with_speech": len(ctx.chunks(analyzer_id)),
                "words": words,
                "spoken_seconds": round(spoken, 2),
                "speech_ratio": round(spoken / ctx.duration, 3) if ctx.duration and spoken else None,
            }
            break

        return out
