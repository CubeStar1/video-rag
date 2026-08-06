from concurrent.futures import ThreadPoolExecutor

import numpy as np

from ..boundaries import semantic
from ..extractors.video import object_detect, openai_call
from .base import Chunks, VideoContext

PROMPT = """\
Describe each person in these images. Yellow boxes are drawn around detected \
people and numbered - use those numbers to say which person you are describing. \
The boxes are an overlay, not part of the scene. If someone is clearly visible but \
has no box, describe them with box_id 0.

For each person give:
- appearance: build, hair, and other features that persist
- clothing: every visible garment and its colour, in as much detail as you can
- role: what they appear to be doing there, e.g. cashier, customer, passer-by
- action: what they do across these frames, including any movement

Clothing and appearance are what will be used to recognise the same person later \
in the video, so be specific and consistent: prefer "man in a white t-shirt and \
yellow shorts" over "customer". Never name anyone or guess who they are.

The images are consecutive frames from one segment, so the same person appears in \
several. Describe each person once, not once per frame."""


class PeopleAnalyzer:
    """People in detail, with each description tied to the box it came from.

    Kept separate from the object analyzer because the output has a different
    job: the `box_id` -> box mapping lets a later pass crop that exact person
    and match them across chunks visually. Descriptions alone are not enough to
    link identities - the same person gets called "customer in white shirt" in
    one chunk and just "customer" in the next.

    YOLO's pass is shared with the object analyzer rather than repeated.
    """

    id = "people"

    def __init__(
        self,
        model: str = openai_call.DEFAULT_MODEL,
        candidate_fps: float = 1.0,
        confidence: float = 0.35,
        min_people: int = 1,
        min_box_area: int = 900,
        similarity_threshold: float = 0.98,
        max_frames: int = 6,
        workers: int = 6,
        max_width: int = 1280,
        detail: str = "high",
        detector: str = "yolo11n.pt",
    ):
        self.model = model
        self.candidate_fps = candidate_fps
        self.confidence = confidence
        self.min_people = min_people
        self.min_box_area = min_box_area
        self.similarity_threshold = similarity_threshold
        self.max_frames = max_frames
        self.workers = workers
        self.max_width = max_width
        self.detail = detail
        self.detector = detector

    def _person_boxes(self, detections):
        """Person detections big enough to describe or crop usefully."""
        return [
            box
            for box, label, _conf in detections
            if label == "person"
            and (box[2] - box[0]) * (box[3] - box[1]) >= self.min_box_area
        ]

    def _sample(self, start: float, end: float, ctx: VideoContext):
        frames = object_detect.detect_in_span(
            ctx, start, end, self.candidate_fps, self.confidence, self.detector
        )
        with_people = [
            (t, frame, boxes)
            for t, frame, dets in frames
            if len(boxes := self._person_boxes(dets)) >= self.min_people
        ]
        if not with_people:
            return []

        embeddings = semantic.embed_images([f for _, f, _ in with_people])

        kept: list[int] = []
        for i in range(len(with_people)):
            if not kept:
                kept.append(i)
                continue
            similar = (embeddings[i] @ embeddings[kept[-1]].T).item() >= self.similarity_threshold
            moved = object_detect.layout_changed(
                frozenset((b[0] // 32, b[1] // 32) for b in with_people[kept[-1]][2]),
                frozenset((b[0] // 32, b[1] // 32) for b in with_people[i][2]),
            )
            if not similar or moved:
                kept.append(i)

        if len(kept) > self.max_frames:
            picks = np.linspace(0, len(kept) - 1, self.max_frames).round().astype(int)
            kept = [kept[i] for i in picks]

        tracked_all = object_detect.track_ids([boxes for _, _, boxes in with_people])

        selected = []
        for i in kept:
            numbered = tracked_all[i]
            t, frame, _ = with_people[i]
            selected.append({
                "time": t,
                "frame": object_detect.annotate_numbered(frame, numbered),
                "boxes": numbered,
            })
        return selected

    def analyze(self, chunks: Chunks, ctx: VideoContext) -> list[dict | None]:
        samples = [self._sample(start, end, ctx) for start, end in chunks]

        def read(i):
            selected = samples[i]
            if not selected:
                return i, None
            try:
                output = openai_call.describe(
                    PROMPT, [s["frame"] for s in selected], model=self.model,
                    schema=openai_call.PEOPLE_SCHEMA,
                    max_width=self.max_width, detail=self.detail,
                )
            except Exception as exc:
                return i, {"people": [], "summary": f"ERROR: {type(exc).__name__}: {exc}"}

            boxes_by_frame = [{"time": s["time"], "boxes": s["boxes"]} for s in selected]
            for person in output.get("people", []):
                box_id = person.get("box_id") or 0
                person["locations"] = [
                    {"time": round(f["time"], 2), "box": f["boxes"][box_id]}
                    for f in boxes_by_frame
                    if box_id in f["boxes"]
                ]

            output["_frames"] = [round(s["time"], 2) for s in selected]
            output["people_count"] = len(output.get("people", []))
            return i, output

        results: list[dict | None] = [None] * len(chunks)
        with ThreadPoolExecutor(max_workers=self.workers) as pool:
            for i, output in pool.map(read, range(len(chunks))):
                results[i] = output
        return results

    def render_fields(self, output: dict) -> dict[str, str]:
        if not output:
            return {}

        people = output.get("people") or []
        described = [
            " - ".join(
                p for p in (
                    person.get("role"), person.get("clothing"),
                    person.get("appearance"), person.get("action"),
                ) if p
            )
            for person in people
        ]
        summary = (output.get("summary") or "").strip()

        combined = "\n".join(p for p in [summary, *described] if p).strip()
        if not combined:
            return {}

        fields = {"combined": combined}
        if summary:
            fields["description"] = summary
        if who := "; ".join(
            " ".join(x for x in (p.get("role"), p.get("clothing"), p.get("appearance")) if x)
            for p in people
        ).strip():
            fields["people"] = who
        if doing := "; ".join(p.get("action", "") for p in people if p.get("action")):
            fields["actions"] = doing
        return fields
