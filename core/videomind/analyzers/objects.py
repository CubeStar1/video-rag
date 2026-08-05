from concurrent.futures import ThreadPoolExecutor

import numpy as np

from ..boundaries import semantic
from ..extractors.video import object_detect, openai_call
from .base import Chunks, VideoContext

PROMPT = """\
Identify the objects in these images. Cyan boxes mark regions where something was \
detected - treat them as hints about where to look, and also include anything \
important they missed. The boxes are an overlay, not part of the scene, and they \
are deliberately unlabelled: identify each object yourself rather than assuming \
what the box was drawn around.

For each distinct object give:
- what it is, as a short name
- what it looks like: colour, material, size, condition
- what it is doing or being used for here, and by whom

The images are consecutive frames from one segment of a video, so the same object \
may appear in several of them. Report each object once, not once per frame, and if \
its use changes across the frames say so.

Report objects that matter to understanding the scene. Skip incidental background \
clutter, and do not guess at things you cannot actually make out."""


class ObjectAnalyzer:
    """Objects with appearance and purpose, gated by cheap detection.

    The scene analyzer already lists object names, but only as a by-product of
    describing a whole segment. Here detection decides which frames are worth
    a call, boxes point the VLM at each region, and the prompt asks what the
    object is *for* - so "shopping cart" becomes "wire shopping cart being
    pushed toward the checkout, half full of groceries".
    """

    id = "object_detection"

    def __init__(
        self,
        model: str = openai_call.DEFAULT_MODEL,
        candidate_fps: float = 1.0,
        confidence: float = 0.35,
        min_objects: int = 1,
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
        self.min_objects = min_objects
        self.similarity_threshold = similarity_threshold
        self.max_frames = max_frames
        self.workers = workers
        self.max_width = max_width
        self.detail = detail
        self.detector = detector

    def _sample(self, start: float, end: float, ctx: VideoContext):
        """Frames containing objects, with near-duplicates removed."""
        # Shared with the people analyzer: one YOLO pass per span, not one each.
        frames = object_detect.detect_in_span(
            ctx, start, end, self.candidate_fps, self.confidence, self.detector
        )
        with_objects = [(t, frame, dets) for t, frame, dets in frames if len(dets) >= self.min_objects]
        if not with_objects:
            return [], [], []  # nothing detected: no API call for this chunk

        embeddings = semantic.embed_images([f for _, f, _ in with_objects])

        kept: list[int] = []
        for i in range(len(with_objects)):
            if not kept:
                kept.append(i)
                continue
            similar = (embeddings[i] @ embeddings[kept[-1]].T).item() >= self.similarity_threshold
            # Objects entering, leaving or moving counts as a change even when
            # the frame as a whole still looks the same.
            moved = object_detect.layout_changed(
                object_detect.layout_signature(with_objects[kept[-1]][2]),
                object_detect.layout_signature(with_objects[i][2]),
            )
            if not similar or moved:
                kept.append(i)

        if len(kept) > self.max_frames:
            picks = np.linspace(0, len(kept) - 1, self.max_frames).round().astype(int)
            kept = [kept[i] for i in picks]

        times = [with_objects[i][0] for i in kept]
        marked = [object_detect.annotate(with_objects[i][1], with_objects[i][2]) for i in kept]
        detected = sorted({label for i in kept for _, label, _ in with_objects[i][2]})
        return times, marked, detected

    def analyze(self, chunks: Chunks, ctx: VideoContext) -> list[dict | None]:
        samples = [self._sample(start, end, ctx) for start, end in chunks]

        def read(i):
            frame_times, frames, detected = samples[i]
            if not frames:
                return i, None
            try:
                output = openai_call.describe(
                    PROMPT, frames, model=self.model, schema=openai_call.OBJECT_SCHEMA,
                    max_width=self.max_width, detail=self.detail,
                )
            except Exception as exc:
                return i, {"detections": [], "summary": f"ERROR: {type(exc).__name__}: {exc}"}

            # Plain names populate the existing filterable `objects` payload
            # field; the rich per-object detail is kept separately.
            output["objects"] = [d["object"] for d in output.get("detections", []) if d.get("object")]
            output["_frames"] = [round(t, 2) for t in frame_times]
            output["_detector_labels"] = detected  # what YOLO thought, for debugging
            return i, output

        results: list[dict | None] = [None] * len(chunks)
        with ThreadPoolExecutor(max_workers=self.workers) as pool:
            for i, output in pool.map(read, range(len(chunks))):
                results[i] = output
        return results

    def render_fields(self, output: dict) -> dict[str, str]:
        if not output:
            return {}

        detections = output.get("detections") or []
        lines = [
            " - ".join(p for p in (d.get("object"), d.get("description"), d.get("context")) if p)
            for d in detections
        ]
        summary = (output.get("summary") or "").strip()

        combined = "\n".join(p for p in [summary, *lines] if p).strip()
        if not combined:
            return {}

        fields = {"combined": combined}
        if summary:
            fields["description"] = summary
        if names := ", ".join(output.get("objects", [])):
            fields["objects"] = names
        # What each object is *for* is often what a search is really after
        # ("something being used to carry groceries"), so it gets its own space.
        if uses := "; ".join(d.get("context", "") for d in detections if d.get("context")):
            fields["actions"] = uses
        return fields
