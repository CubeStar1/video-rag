from concurrent.futures import ThreadPoolExecutor

import numpy as np

from ..boundaries import semantic
from ..extractors.video import openai_call
from .base import Chunks, VideoContext

PROMPT = """\
Describe this scene for a video search index. Cover: who and what is visible, the \
setting, and what is happening. Be specific and factual - this description is what \
users will search against.

The images are frames sampled in chronological order from a single continuous segment \
of one video. They are not separate scenes - treat them as one moment unfolding over \
time, and describe any movement or change across them (for example, someone moving \
from one place to another, or something appearing or disappearing).

Describe only what is actually visible. Do not identify individuals by name, and do \
not infer motion you cannot see across the frames."""


class SceneAnalyzer:
    """General scene description: CLIP-diverse frame sampling -> VLM -> structured output.

    Owns its sampling technique as well as its prompt. A future analyzer that
    should only fire under some condition would implement its own `_sample`
    rather than reusing this one.
    """

    id = "default_video"

    def __init__(
        self,
        model: str = openai_call.DEFAULT_MODEL,
        candidate_fps: float = 2.0,
        percentile: float = 40.0,
        max_similarity: float = 0.98,
        min_frames: int = 4,
        max_frames: int = 8,
        workers: int = 6,
    ):
        self.model = model
        self.candidate_fps = candidate_fps
        self.percentile = percentile
        self.max_similarity = max_similarity
        self.min_frames = min_frames
        self.max_frames = max_frames
        self.workers = workers

    def _sample(self, start: float, end: float, ctx: VideoContext):
        """Frames that differ enough from each other to be worth an API call.

        Returns (timestamps, frames) - the timestamps are recorded on the
        output so a saved record shows which frames a description came from.
        """
        timestamps, candidates = ctx.frames(start, end, fps=self.candidate_fps)
        if not candidates:
            return [], []

        embeddings = semantic.embed_images(candidates)
        consecutive = [
            (embeddings[i - 1] @ embeddings[i].T).item() for i in range(1, len(embeddings))
        ]
        adaptive = float(np.percentile(consecutive, self.percentile)) if consecutive else 1.0
        # Cap the adaptive threshold: on a static chunk the percentile lands on
        # the median (~0.999) and "distinct" frames get mined out of noise.
        threshold = min(adaptive, self.max_similarity)

        kept = [0]
        for i in range(1, len(candidates)):
            if (embeddings[i] @ embeddings[kept[-1]].T).item() < threshold:
                kept.append(i)

        if len(kept) < self.min_frames:
            target = min(self.min_frames, len(candidates))
            picks = np.linspace(0, len(candidates) - 1, target).round().astype(int)
            kept = sorted(set(kept) | set(picks.tolist()))

        # Thin against evenly spaced points in time, not positions in the kept
        # list, so a near-duplicate pair cannot survive beside a long gap.
        if len(kept) > self.max_frames:
            targets = np.linspace(timestamps[kept[0]], timestamps[kept[-1]], self.max_frames)
            chosen = []
            for target in targets:
                nearest = min(kept, key=lambda i: abs(timestamps[i] - target))
                if nearest not in chosen:
                    chosen.append(nearest)
            kept = sorted(chosen)

        return [timestamps[i] for i in kept], [candidates[i] for i in kept]

    def analyze(self, chunks: Chunks, ctx: VideoContext) -> list[dict]:
        # Sampling is serial (shared CLIP model on one GPU); the API calls are
        # I/O bound so they run concurrently.
        samples = [self._sample(start, end, ctx) for start, end in chunks]

        def describe(i):
            frame_times, frames = samples[i]
            if not frames:
                return i, None
            try:
                output = openai_call.describe(PROMPT, frames, model=self.model)
            except Exception as exc:
                output = {"description": f"ERROR: {type(exc).__name__}: {exc}"}
            # Underscore-prefixed: kept in the saved record for debugging, but
            # ignored by render_fields and never copied into the vector payload.
            output["_frames"] = [round(t, 2) for t in frame_times]
            return i, output

        results: list[dict | None] = [None] * len(chunks)
        with ThreadPoolExecutor(max_workers=self.workers) as pool:
            for i, output in pool.map(describe, range(len(chunks))):
                results[i] = output
        return results

    def render_fields(self, output: dict) -> dict[str, str]:
        if not output:
            return {}

        parts = [output.get("description", "")]
        if setting := output.get("setting"):
            parts.append(f"Setting: {setting}")
        for field in ("people", "actions", "objects", "tags"):
            if values := output.get(field):
                parts.append(f"{field.capitalize()}: {', '.join(values)}")

        fields = {"combined": "\n".join(p for p in parts if p).strip()}
        if description := output.get("description", "").strip():
            fields["description"] = description
        # people/actions read as full clauses so they embed well alone;
        # tags and setting stay filter-only, too repetitive to carry signal.
        if people := output.get("people"):
            fields["people"] = "; ".join(people)
        if actions := output.get("actions"):
            fields["actions"] = "; ".join(actions)
        if objects := output.get("objects"):
            fields["objects"] = ", ".join(objects)

        return {k: v for k, v in fields.items() if v.strip()}
