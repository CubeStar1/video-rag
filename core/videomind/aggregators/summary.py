import math

from .base import AggregateContext
from .llm import chunk_lines, complete, pick_analyzers

PREFERENCE = ("default_video", "people", "diarization", "transcript", "object_detection", "ocr")

SCHEMA = {
    "name": "video_summary",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["summary", "key_points", "topics"],
        "properties": {
            "summary": {"type": "string", "description": "A few sentences covering the whole video."},
            "key_points": {
                "type": "array", "items": {"type": "string"},
                "description": "The things a viewer would most need to know.",
            },
            "topics": {
                "type": "array", "items": {"type": "string"},
                "description": "Short topic labels for what the video covers.",
            },
        },
    },
}

LEAF_PROMPT = """\
These are consecutive segments of one video, each with its timecode. Summarise \
what happens across them in 2-3 sentences. Stay factual and keep any detail that \
would matter to someone searching this footage later.

{lines}"""

MERGE_PROMPT = """\
These are summaries of consecutive parts of one stretch of video, in order. \
Combine them into a single summary of the whole stretch, in 2-3 sentences. Keep \
what matters and drop repetition; do not add anything not present below.

{parts}"""

FINAL_PROMPT = """\
These summaries cover consecutive stretches of a single video, in order. Produce \
an overall summary of the whole video, the key points a viewer would need, and \
short topic labels.

Base it only on what is below - do not speculate about what happens off-screen.

{sections}"""


class SummaryAggregator:
    """A hierarchy of summaries, from fine detail up to the whole video.

    Built by halving: the video splits in two, each half in two again, until a
    leaf covers few enough chunks to stay specific. Leaves are summarised from
    chunk text, and every level above merges its children.

    Depth is derived from length rather than fixed, because a fixed block size
    means the same setting produces four-minute leaf summaries on a long video
    and near-duplicate ones on a short clip. The middle tiers are the point for
    question answering: they give retrieval something between a single 40-second
    window and the entire video to match a question against.
    """

    id = "summary"
    depends_on = ()

    def __init__(
        self,
        model: str | None = None,
        max_leaf_chunks: int = 5,
        min_tiers: int = 3,
        max_tiers: int = 6,
    ):
        self.model = model
        self.max_leaf_chunks = max_leaf_chunks
        self.min_tiers = min_tiers
        self.max_tiers = max_tiers

    def _depth(self, chunk_count: int) -> int:
        """Enough halvings for a leaf to hold at most `max_leaf_chunks`."""
        needed = 1
        while chunk_count / (2 ** (needed - 1)) > self.max_leaf_chunks:
            needed += 1
            if needed >= self.max_tiers:
                break
        return max(self.min_tiers, min(needed, self.max_tiers))

    @staticmethod
    def _split(spans):
        out = []
        for first, last in spans:
            middle = first + (last - first + 1) // 2
            out.append((first, middle - 1))
            out.append((middle, last))
        return [s for s in out if s[0] <= s[1]]

    def aggregate(self, ctx: AggregateContext) -> dict | None:
        analyzers = pick_analyzers(ctx, PREFERENCE)
        if not analyzers:
            return None
        lines = chunk_lines(ctx, analyzers)
        if not lines:
            return None
        chunks = [c for c in ctx.chunks() if any(c.get(a) for a in analyzers)]
        count = len(chunks)

        tiers = self._depth(count)
        levels = [[(0, count - 1)]]
        while len(levels) < tiers and len(levels[-1]) < count:
            levels.append(self._split(levels[-1]))

        def describe(first, last):
            return {
                "chunk_ids": [c["id"] for c in chunks[first : last + 1]],
                "start": chunks[first]["start"],
                "end": chunks[last]["end"],
            }

        # Leaves come from chunk text; every tier above merges its children,
        # so the whole-video summary is a reduction rather than one huge prompt.
        leaves = []
        for first, last in levels[-1]:
            text = complete(
                LEAF_PROMPT.format(lines="\n".join(lines[first : last + 1])), model=self.model
            )
            leaves.append({"summary": text, **describe(first, last)})

        hierarchy = [leaves]
        for spans in reversed(levels[:-1]):
            below = hierarchy[-1]
            level = []
            for first, last in spans:
                children = [s for s in below if s["chunk_ids"] and s["chunk_ids"][0] >= first
                            and s["chunk_ids"][-1] <= last]
                if len(children) == 1:
                    level.append({**children[0], **describe(first, last)})
                    continue
                parts = "\n\n".join(
                    f"[{c['start']:.0f}-{c['end']:.0f}s] {c['summary']}" for c in children
                )
                level.append({
                    "summary": complete(MERGE_PROMPT.format(parts=parts), model=self.model),
                    **describe(first, last),
                })
            hierarchy.append(level)

        top = hierarchy[-1]
        body = "\n\n".join(f"[{s['start']:.0f}-{s['end']:.0f}s] {s['summary']}" for s in top)
        final = complete(FINAL_PROMPT.format(sections=body), schema=SCHEMA, model=self.model)

        # Finest first, so `tiers[0]` is always the most detailed level.
        final["tiers"] = [
            {"level": i, "sections": level, "section_count": len(level)}
            for i, level in enumerate(hierarchy)
        ]
        final["sections"] = hierarchy[0]  # finest, for retrieval
        final["depth"] = len(hierarchy)
        final["based_on"] = analyzers
        return final
