import torch

from .base import AggregateContext
from .llm import chunk_lines, pick_analyzers

_model = None

# Zero-shot, so the label set is a parameter rather than whatever the model was
# trained on. These suit surveillance and general footage; pass your own for a
# different domain.
DEFAULT_LABELS = (
    "person", "organization", "location", "product", "brand",
    "date", "time", "money", "vehicle", "job title",
)

PREFERENCE = ("diarization", "transcript", "default_video", "ocr", "people", "object_detection")

# Pronouns and bare determiners are grammatically people but identify nobody,
# and they dominate a mention count if left in.
STOP_ENTITIES = frozenset({
    "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
    "my", "your", "his", "its", "our", "their", "this", "that", "these", "those",
    "someone", "somebody", "anyone", "everyone", "one", "who", "whom",
})


def _get_model(name: str):
    global _model
    if _model is None:
        from gliner import GLiNER

        _model = GLiNER.from_pretrained(name)
        if torch.cuda.is_available():
            _model = _model.to("cuda")
        _model.eval()
    return _model


class NERAggregator:
    """Named entities across everything the analyzers wrote.

    Runs locally on the GPU, so it costs nothing per video and can be re-run
    freely with different label sets. Reads scene descriptions and OCR as well
    as speech - a brand name on a package is as much an entity as one that was
    spoken aloud.
    """

    id = "ner"
    depends_on = ()

    def __init__(self, model_name: str = "urchade/gliner_small-v2.1",
                 labels: tuple[str, ...] = DEFAULT_LABELS, threshold: float = 0.5):
        self.model_name = model_name
        self.labels = list(labels)
        self.threshold = threshold

    def aggregate(self, ctx: AggregateContext) -> dict | None:
        analyzers = pick_analyzers(ctx, PREFERENCE)
        if not analyzers:
            return None

        # Deliberately not chunk_lines(): for diarization that renders
        # "SPEAKER_01: ..." and the model duly reports SPEAKER_01 as a person -
        # extracting our own formatting rather than anything in the video.
        passages = []
        for chunk in ctx.chunks():
            parts = []
            for analyzer_id in analyzers:
                output = chunk.get(analyzer_id)
                if not output:
                    continue
                if isinstance(output, str):
                    parts.append(output)
                elif analyzer_id == "diarization":
                    parts.append(output.get("plain") or "")
                else:
                    parts.append(output.get("description") or output.get("summary") or "")
            body = " ".join(p for p in parts if p).strip()
            if body:
                passages.append((chunk, body[:600]))
        if not passages:
            return None

        model = _get_model(self.model_name)

        found: dict[tuple[str, str], dict] = {}
        for chunk, body in passages:
            for entity in model.predict_entities(body, self.labels, threshold=self.threshold):
                text = entity["text"].strip()
                if text.lower() in STOP_ENTITIES or len(text) < 2:
                    continue
                key = (text.lower(), entity["label"])
                record = found.setdefault(key, {
                    "text": text,
                    "label": entity["label"],
                    "mentions": 0,
                    "score": 0.0,
                    "chunk_ids": [],
                })
                record["mentions"] += 1
                record["score"] = max(record["score"], round(float(entity["score"]), 3))
                if chunk["id"] not in record["chunk_ids"]:
                    record["chunk_ids"].append(chunk["id"])

        entities = sorted(found.values(), key=lambda e: (-e["mentions"], -e["score"]))
        if not entities:
            return None

        by_label: dict[str, list[str]] = {}
        for entity in entities:
            by_label.setdefault(entity["label"], []).append(entity["text"])

        return {
            "entities": entities,
            "by_label": by_label,
            "labels_used": self.labels,
            "based_on": analyzers,
        }
