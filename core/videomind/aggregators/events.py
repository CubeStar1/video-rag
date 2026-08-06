from .base import AggregateContext
from .llm import chunk_lines, complete, pick_analyzers

PREFERENCE = ("default_video", "people", "object_detection", "diarization", "transcript", "ocr")

SCHEMA = {
    "name": "video_events",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["events"],
        "properties": {
            "events": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["event", "chunk_id", "actor", "category"],
                    "properties": {
                        "event": {"type": "string", "description": "What happened, one short sentence."},
                        "chunk_id": {"type": "integer", "description": "Chunk the event occurs in."},
                        "actor": {"type": "string", "description": "Who or what did it, as described; empty if unclear."},
                        "category": {
                            "type": "string",
                            "description": "Kind of event, e.g. arrival, departure, transaction, interaction, movement, speech.",
                        },
                    },
                },
            }
        },
    },
}

PROMPT = """\
Below are consecutive segments of one video, each with its chunk id and timecode.

Extract the discrete events that happen - things that occur at a point in time, \
such as someone arriving or leaving, a transaction completing, an object changing \
hands, or a notable interaction.

Rules:
- Only report events actually supported by the text below.
- Use the chunk ids exactly as given.
- One entry per event, not one per chunk. Skip chunks where nothing discrete happens.
- Ongoing background activity is not an event.

{lines}"""


class EventsAggregator:
    """Discrete timestamped events.

    Complements the summary: a summary says what a video is about, events say
    what happened and when. Being structured and chunk-anchored makes them
    queryable and citable, where prose is neither.
    """

    id = "events"
    depends_on = ()

    def __init__(self, model: str | None = None):
        self.model = model

    def aggregate(self, ctx: AggregateContext) -> dict | None:
        analyzers = pick_analyzers(ctx, PREFERENCE)
        if not analyzers:
            return None
        lines = chunk_lines(ctx, analyzers, limit=300)
        if not lines:
            return None

        result = complete(PROMPT.format(lines="\n".join(lines)), schema=SCHEMA, model=self.model)

        by_id = {c["id"]: c for c in ctx.chunks()}
        events = []
        for event in result.get("events", []):
            chunk = by_id.get(event["chunk_id"])
            if chunk is None:
                continue
            events.append({**event, "start": chunk["start"], "end": chunk["end"]})
        events.sort(key=lambda e: e["start"])

        categories: dict[str, int] = {}
        for event in events:
            categories[event["category"]] = categories.get(event["category"], 0) + 1

        return {"events": events, "categories": categories, "based_on": analyzers} if events else None
