from dataclasses import dataclass

import numpy as np

from ....boundaries import semantic
from .. import frames as frame_reader

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


@dataclass
class Sample:
    """What a sampler hands to the API: the frames, when they came from, and the prompt."""

    timestamps: list[float]
    frames: list[np.ndarray]
    prompt: str


def sample(
    video_path: str,
    start: float,
    end: float,
    candidate_fps: float = 2.0,
    similarity_threshold: float | None = None,
    percentile: float = 40.0,
    max_similarity: float = 0.98,
    min_frames: int = 4,
    max_frames: int = 8,
) -> Sample:
    """Sample visually distinct frames from one chunk.

    Reads dense candidates, then greedily keeps a frame only once it has
    drifted far enough from the last kept frame.

    The threshold adapts to the chunk by default, because a single fixed
    value cannot serve different footage: on a moving camera consecutive
    frames may sit around 0.80 similarity, while on a fixed overhead camera
    they sit above 0.98 and a fixed 0.95 cutoff would keep only one frame.
    Instead the cutoff is drawn from this chunk's own distribution of
    consecutive similarities, so a frame is kept once accumulated change
    exceeds a typical single step - a subject crossing the scene counts even
    when everything around it is static. Pass `similarity_threshold`
    explicitly to override.

    `min_frames` guarantees the API always sees motion rather than one
    still image it would be forced to guess about; `max_frames` caps cost.
    """
    timestamps, candidates = frame_reader.read_frames(video_path, start, end, fps=candidate_fps)
    if not candidates:
        return Sample(timestamps=[], frames=[], prompt=PROMPT)

    embeddings = semantic.embed_images(candidates)

    if similarity_threshold is None:
        consecutive = [(embeddings[i - 1] @ embeddings[i].T).item() for i in range(1, len(embeddings))]
        adaptive = float(np.percentile(consecutive, percentile)) if consecutive else 1.0
        # The percentile alone is purely relative, so on a chunk where nothing
        # happens it lands on the median (~0.999) and "distinct" frames get
        # mined out of compression noise. `max_similarity` is the floor on
        # real change: above it the chunk is static, nothing clears the bar,
        # and the min_frames top-up below returns evenly spaced frames instead.
        similarity_threshold = min(adaptive, max_similarity)

    kept = [0]
    for i in range(1, len(candidates)):
        similarity = (embeddings[i] @ embeddings[kept[-1]].T).item()
        if similarity < similarity_threshold:
            kept.append(i)

    # Too few distinct frames (a near-static chunk): top up with evenly
    # spaced ones so the model still sees the chunk unfold over time.
    if len(kept) < min_frames:
        target = min(min_frames, len(candidates))
        picks = np.linspace(0, len(candidates) - 1, target).round().astype(int)
        kept = sorted(set(kept) | set(picks.tolist()))

    # Cost ceiling. Thin against evenly spaced points in *time*, not evenly
    # spaced positions in the kept list: the latter preserves whatever
    # clustering the greedy pass produced, which is how a 0.53s-apart pair
    # survived alongside a 3.74s gap in the same chunk.
    if len(kept) > max_frames:
        targets = np.linspace(timestamps[kept[0]], timestamps[kept[-1]], max_frames)
        chosen = []
        for target in targets:
            nearest = min(kept, key=lambda i: abs(timestamps[i] - target))
            if nearest not in chosen:
                chosen.append(nearest)
        kept = sorted(chosen)

    return Sample(
        timestamps=[timestamps[i] for i in kept],
        frames=[candidates[i] for i in kept],
        prompt=PROMPT,
    )
