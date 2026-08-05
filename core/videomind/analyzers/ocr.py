from concurrent.futures import ThreadPoolExecutor

import numpy as np

from ..boundaries import semantic
from ..extractors.video import openai_call, text_detect
from .base import Chunks, VideoContext

PROMPT = """\
Read the text visible in these images. Red boxes mark regions where text was \
detected - treat them as hints, and also read any text they missed. Ignore the \
boxes themselves; they are an overlay, not part of the scene.

For every distinct piece of text, give it exactly as written, and say what it is \
and where it appears - for example "a label on a cupboard", "a street sign", "a \
timestamp burned into the footage", "a readout on a targeting display".

The images are consecutive frames from one segment of a video, so the same text \
may appear in several of them. Report each distinct piece of text once, not once \
per frame. If a piece of text changes between frames, report the versions \
separately and say so.

Transcribe only what you can actually read. Do not guess at text that is blurred \
or cut off, and do not describe the scene beyond what is needed to place the text."""


class OCRAnalyzer:
    """On-screen text: cheap detection gates which frames a VLM ever sees.

    EasyOCR's detector answers "is there text here, and where" for a fraction
    of the cost of a VLM call, so frames without text are dropped before any
    API spend. Its recognition stage is skipped - it fragments lines and reads
    low-contrast overlays poorly - and the VLM does the actual reading, with
    the detected regions boxed to point its attention.
    """

    id = "ocr"

    def __init__(
        self,
        model: str = openai_call.DEFAULT_MODEL,
        candidate_fps: float = 1.0,
        min_boxes: int = 1,
        similarity_threshold: float = 0.985,
        max_frames: int = 6,
        workers: int = 6,
        # Reading text needs far more resolution than describing a scene. At
        # the 768px default, small or low-contrast text is simply illegible:
        # on HUD footage that width missed the range and target labels
        # entirely, while 1600px + detail="high" recovered them.
        max_width: int = 1600,
        detail: str = "high",
    ):
        self.model = model
        self.candidate_fps = candidate_fps
        self.min_boxes = min_boxes
        self.similarity_threshold = similarity_threshold
        self.max_frames = max_frames
        self.workers = workers
        self.max_width = max_width
        self.detail = detail

    def _sample(self, start: float, end: float, ctx: VideoContext):
        """Frames that contain text and are not near-duplicates of each other."""
        timestamps, candidates = ctx.frames(start, end, fps=self.candidate_fps)
        if not candidates:
            return [], []

        with_text = [
            (t, frame, boxes)
            for t, frame in zip(timestamps, candidates)
            if len(boxes := text_detect.detect_boxes(frame)) >= self.min_boxes
        ]
        if not with_text:
            return [], []  # nothing to read: no API call for this chunk

        embeddings = semantic.embed_images([f for _, f, _ in with_text])

        kept: list[int] = []
        for i in range(len(with_text)):
            if not kept:
                kept.append(i)
                continue
            similar = (embeddings[i] @ embeddings[kept[-1]].T).item() >= self.similarity_threshold
            # An image-similarity check alone would drop a frame whose text
            # changed while the scene stayed still, so a shifted text layout
            # also counts as new.
            moved = text_detect.layout_changed(
                text_detect.layout_signature(with_text[kept[-1]][2]),
                text_detect.layout_signature(with_text[i][2]),
            )
            if not similar or moved:
                kept.append(i)

        if len(kept) > self.max_frames:
            picks = np.linspace(0, len(kept) - 1, self.max_frames).round().astype(int)
            kept = [kept[i] for i in picks]

        times = [with_text[i][0] for i in kept]
        marked = [text_detect.annotate(with_text[i][1], with_text[i][2]) for i in kept]
        return times, marked

    def analyze(self, chunks: Chunks, ctx: VideoContext) -> list[dict | None]:
        samples = [self._sample(start, end, ctx) for start, end in chunks]

        def read(i):
            frame_times, frames = samples[i]
            if not frames:
                return i, None
            try:
                output = openai_call.describe(
                    PROMPT, frames, model=self.model, schema=openai_call.OCR_SCHEMA,
                    max_width=self.max_width, detail=self.detail,
                )
            except Exception as exc:
                return i, {"texts": [], "summary": f"ERROR: {type(exc).__name__}: {exc}"}
            output["_frames"] = [round(t, 2) for t in frame_times]
            return i, output

        results: list[dict | None] = [None] * len(chunks)
        with ThreadPoolExecutor(max_workers=self.workers) as pool:
            for i, output in pool.map(read, range(len(chunks))):
                results[i] = output
        return results

    def render_fields(self, output: dict) -> dict[str, str]:
        if not output:
            return {}

        entries = output.get("texts") or []
        # Both halves are searchable: the words themselves, and what they are.
        # "sign above the checkout" should find it as readily as its wording.
        lines = [f"{e.get('text', '')} - {e.get('context', '')}".strip(" -") for e in entries]
        summary = (output.get("summary") or "").strip()

        combined = "\n".join(p for p in [summary, *lines] if p).strip()
        if not combined:
            return {}

        fields = {"combined": combined}
        if summary:
            fields["description"] = summary
        if raw := " ".join(e.get("text", "") for e in entries).strip():
            fields["objects"] = raw  # the literal strings, without their descriptions
        return fields
