from .base import AggregateContext
from .entities import link_observations
from .llm import complete

NARRATIVE_SCHEMA = {
    "name": "object_narrative",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["description", "narrative", "role"],
        "properties": {
            "description": {"type": "string", "description": "How to recognise this object, in one line."},
            "narrative": {"type": "string", "description": "How it was used across the video, in order."},
            "role": {"type": "string", "description": "What it is for here, e.g. 'carries shopping'."},
        },
    },
}

NARRATIVE_PROMPT = """\
Below are separate sightings of what appears to be the same object, taken from \
consecutive segments of one video, in time order.

Write a single account of how this object was used across the video, a one-line \
description of how to recognise it, and what it is for here.

Only use what is below. If the sightings conflict, prefer what appears most often. \
Do not claim it moved between places unless the sightings say so.

{observations}"""

# Things bolted to the room. Linking them is technically correct and practically
# useless: "the checkout counter was present throughout" is true of every frame
# and tells a search nothing. They are still counted, just not tracked.
FIXTURE_WORDS = (
    "counter", "register", "conveyor", "shelf", "shelves", "shelving", "aisle",
    "display", "rack", "floor", "ceiling", "wall", "door", "window", "sign",
    "light", "monitor", "screen", "scanner", "terminal", "station", "lane",
)

# The object analyzer also describes people; those belong to the people
# aggregator, which has clothing to identify them with.
PERSON_WORDS = (
    "customer", "cashier", "shopper", "employee", "staff", "worker",
    "man", "woman", "person", "people", "child", "attendant",
)


def _classify(name: str) -> str:
    lowered = name.lower()
    if any(word in lowered for word in PERSON_WORDS):
        return "person"
    if any(word in lowered for word in FIXTURE_WORDS):
        return "fixture"
    return "mobile"


class ObjectEntityAggregator:
    """Links object sightings across chunks into individual objects.

    The same appearance-clustering as people, on a source where identity is
    inherently weaker: two shopping carts genuinely look alike, where two people
    rarely wear the same clothes. The distinctiveness gate carries the weight -
    a cart described only as "metal wire cart" identifies no particular cart and
    is left untracked, while "cart loaded with bags of rice" links.

    Static fixtures are counted but not tracked, and people are handed to the
    people aggregator, so what remains is the mobile objects worth following.
    """

    id = "object_entities"
    depends_on = ("object_detection",)

    def __init__(
        self,
        model: str | None = None,
        link_threshold: float = 0.88,
        generic_threshold: float = 0.80,
        dedupe_threshold: float = 0.95,
        narrate_min_appearances: int = 2,
        max_narratives: int = 8,
    ):
        self.model = model
        self.link_threshold = link_threshold
        self.generic_threshold = generic_threshold
        self.dedupe_threshold = dedupe_threshold
        self.narrate_min_appearances = narrate_min_appearances
        self.max_narratives = max_narratives

    def aggregate(self, ctx: AggregateContext) -> dict | None:
        observations, fixtures, people = [], {}, {}
        for chunk in ctx.chunks("object_detection"):
            for item in chunk["object_detection"].get("detections", []):
                name = (item.get("object") or "").strip()
                signature = (item.get("description") or name).strip()
                if not signature:
                    continue
                kind = _classify(name)
                if kind == "fixture":
                    fixtures[name] = fixtures.get(name, 0) + 1
                    continue
                if kind == "person":
                    people[name] = people.get(name, 0) + 1
                    continue
                observations.append({
                    "chunk_id": chunk["id"],
                    "start": chunk["start"],
                    "end": chunk["end"],
                    "object": name,
                    "signature": signature,
                    "context": item.get("context", ""),
                })

        if len(observations) < 2:
            return None

        groups, genericness = link_observations(
            observations, self.link_threshold, self.generic_threshold, self.dedupe_threshold
        )

        objects = []
        for index, indices in enumerate(groups):
            group = sorted((observations[i] for i in indices), key=lambda o: o["start"])
            objects.append({
                "object_id": f"{ctx.video_id[:8]}-o{index:03d}",
                "video_id": ctx.video_id,
                "name": max((o["object"] for o in group), key=len),
                "appearances": len(group),
                "chunk_ids": sorted({o["chunk_id"] for o in group}),
                "first_seen": min(o["start"] for o in group),
                "last_seen": max(o["end"] for o in group),
                "signature": max((o["signature"] for o in group), key=len),
                "distinctive": bool(genericness[indices[0]] < self.generic_threshold),
                "observations": [
                    {k: o[k] for k in ("chunk_id", "start", "end", "object", "signature", "context")}
                    for o in group
                ],
            })

        objects.sort(key=lambda o: (-o["appearances"], o["first_seen"]))

        narrated = 0
        for entry in objects:
            if entry["appearances"] < self.narrate_min_appearances or narrated >= self.max_narratives:
                continue
            lines = "\n".join(
                f"[{o['start']:.0f}-{o['end']:.0f}s] {o['signature']} | {o['context']}"
                for o in entry["observations"]
            )
            try:
                entry.update(complete(
                    NARRATIVE_PROMPT.format(observations=lines),
                    schema=NARRATIVE_SCHEMA, model=self.model,
                ))
                narrated += 1
            except Exception as exc:
                entry["narrative"] = f"ERROR: {type(exc).__name__}: {exc}"

        linked = [o for o in objects if o["appearances"] > 1]
        return {
            "objects": objects,
            "total": len(objects),
            "linked": len(linked),
            "unlinked": len(objects) - len(linked),
            "observations": len(observations),
            "narrated": narrated,
            # Reported rather than tracked, so it is clear what was set aside.
            "fixtures": sorted(fixtures.items(), key=lambda kv: -kv[1])[:15],
            "people_sightings": sum(people.values()),
        }
