import torch

from .base import AggregateContext

_pipeline = None

MODEL = "cardiffnlp/twitter-roberta-base-sentiment-latest"


def _get_pipeline(model_name: str):
    global _pipeline
    if _pipeline is None:
        from transformers import pipeline

        _pipeline = pipeline(
            "sentiment-analysis",
            model=model_name,
            device=0 if torch.cuda.is_available() else -1,
            truncation=True,
        )
    return _pipeline


class SentimentAggregator:
    """Sentiment of the language people use, per speaker and over time.

    Runs on speech only. A VLM's description of a shop floor has no affect to
    measure - scoring it would produce a number that looks meaningful and is
    not. Results are reported as language observed rather than emotion felt:
    the model reads words, and ASR output is noisy, so "negative language" is
    a claim that survives scrutiny where "the speaker was unhappy" would not.
    """

    id = "sentiment"
    depends_on = ("diarization",)

    def __init__(self, model_name: str = MODEL):
        self.model_name = model_name

    def _segments(self, ctx: AggregateContext) -> list[dict]:
        if ctx.has("diarization"):
            return [
                {"speaker": t["speaker"], "start": t["start"], "end": t["end"],
                 "text": t["text"], "chunk_id": c["id"]}
                for c in ctx.chunks("diarization")
                for t in c["diarization"].get("turns", [])
                if t.get("text", "").strip()
            ]
        if ctx.has("transcript"):
            return [
                {"speaker": None, "start": c["start"], "end": c["end"],
                 "text": c["transcript"], "chunk_id": c["id"]}
                for c in ctx.chunks("transcript")
                if str(c.get("transcript", "")).strip()
            ]
        return []

    def aggregate(self, ctx: AggregateContext) -> dict | None:
        segments = self._segments(ctx)
        if not segments:
            return None

        classifier = _get_pipeline(self.model_name)
        scored = classifier([s["text"] for s in segments])

        timeline, per_speaker = [], {}
        for segment, result in zip(segments, scored):
            label = result["label"].lower()
            entry = {
                **{k: segment[k] for k in ("speaker", "start", "end", "chunk_id")},
                "label": label,
                "score": round(float(result["score"]), 3),
                "text": segment["text"][:160],
            }
            timeline.append(entry)
            if segment["speaker"]:
                bucket = per_speaker.setdefault(
                    segment["speaker"],
                    {"speaker": segment["speaker"], "positive": 0, "neutral": 0, "negative": 0},
                )
                bucket[label] = bucket.get(label, 0) + 1

        overall: dict[str, int] = {}
        for entry in timeline:
            overall[entry["label"]] = overall.get(entry["label"], 0) + 1

        for bucket in per_speaker.values():
            total = sum(bucket[k] for k in ("positive", "neutral", "negative")) or 1
            bucket["dominant"] = max(("positive", "neutral", "negative"), key=lambda k: bucket[k])
            bucket["negative_share"] = round(bucket["negative"] / total, 3)

        return {
            "model": self.model_name,
            "overall": overall,
            "dominant": max(overall, key=overall.get) if overall else None,
            "per_speaker": list(per_speaker.values()),
            "timeline": timeline,
            "note": "Sentiment of language used, not inferred emotion; ASR errors propagate.",
        }
