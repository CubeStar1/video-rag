from .base import AggregateContext
from .llm import chunk_lines, complete, pick_analyzers

PREFERENCE = ("default_video", "people", "diarization", "transcript", "object_detection", "ocr")

SCHEMA = {
    "name": "video_chapters",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["chapters"],
        "properties": {
            "chapters": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["title", "first_chunk", "last_chunk", "summary"],
                    "properties": {
                        "title": {"type": "string", "description": "Short label, a few words."},
                        "first_chunk": {"type": "integer", "description": "Id of the first chunk in this chapter."},
                        "last_chunk": {"type": "integer", "description": "Id of the last chunk in this chapter."},
                        "summary": {"type": "string", "description": "One sentence on what happens here."},
                    },
                },
            }
        },
    },
}

PROMPT = """\
Below are consecutive segments of one video, each with its chunk id and timecode.

Group them into chapters: runs of consecutive chunks that belong together \
because the same thing is going on. Give each chapter a short title and a \
one-sentence summary.

Rules:
- Chapters must be consecutive and must not overlap.
- Every chunk must fall inside exactly one chapter.
- Use the chunk ids exactly as given.
- Prefer a handful of meaningful chapters over many tiny ones.

{lines}"""


class ChaptersAggregator:
    """Consecutive chunks grouped into named sections.

    Gives the video a navigable structure - a timeline a person can click and
    a coarse index an agent can drill into - which is what "topics" is
    actually useful for at single-video scale, where statistical topic models
    have far too little text to work with.
    """

    id = "chapters"
    depends_on = ()

    def __init__(self, model: str | None = None):
        self.model = model

    def aggregate(self, ctx: AggregateContext) -> dict | None:
        analyzers = pick_analyzers(ctx, PREFERENCE)
        if not analyzers:
            return None
        lines = chunk_lines(ctx, analyzers, limit=240)
        if len(lines) < 2:
            return None

        result = complete(PROMPT.format(lines="\n".join(lines)), schema=SCHEMA, model=self.model)

        by_id = {c["id"]: c for c in ctx.chunks()}
        chapters = []
        for chapter in result.get("chapters", []):
            first, last = by_id.get(chapter["first_chunk"]), by_id.get(chapter["last_chunk"])
            if first is None or last is None:
                continue
            chapters.append({
                **chapter,
                "start": first["start"],
                "end": last["end"],
                "chunk_ids": [i for i in range(chapter["first_chunk"], chapter["last_chunk"] + 1) if i in by_id],
            })
        chapters.sort(key=lambda c: c["start"])
        return {"chapters": chapters, "based_on": analyzers} if chapters else None
