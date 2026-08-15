import numpy as np

from ..vectordb import get_embedder
from .base import AggregateContext
from .llm import complete

NARRATIVE_SCHEMA = {
    "name": "person_narrative",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["description", "narrative", "role"],
        "properties": {
            "description": {"type": "string", "description": "How to recognise this person, in one line."},
            "narrative": {"type": "string", "description": "What they did across the video, in order."},
            "role": {"type": "string", "description": "Their apparent role, e.g. customer, staff."},
        },
    },
}

NARRATIVE_PROMPT = """\
Below are separate observations of what appears to be the same person, taken from \
consecutive segments of one video, in time order.

Write a single coherent account of what this person did across the video, a one-line \
description of how to recognise them, and their apparent role.

Only use what is below. If the observations conflict, prefer what appears most often \
and do not invent a reason for the difference. Never give the person a name.

{observations}"""


def link_observations(
    observations: list[dict],
    link_threshold: float,
    generic_threshold: float,
    dedupe_threshold: float,
) -> tuple[list[list[int]], np.ndarray]:
    """Group observations of the same subject, by appearance under constraints.

    Shared by people and objects: the reasoning is identical either way, only
    the source field differs. Returns index groups plus each observation's
    genericness, so callers can report what was too vague to link.

    Constraints, in order:
      within-chunk merge - the analyzer's own tracker splits one subject into
        two sightings of the same chunk; merged first, otherwise cannot-link
        would permanently forbid reuniting them
      cannot-link        - two subjects visible in the same chunk are different
      distinctness       - a description resembling everything identifies
        nothing, so its owner stays unlinked rather than being merged into
        whatever it drifted closest to
    """
    count = len(observations)
    if count < 2:
        return [[i] for i in range(count)], np.zeros(count)

    embedder = get_embedder()
    vectors = embedder.embed_documents([o["signature"] for o in observations])
    similarity = vectors @ vectors.T

    merged_into: dict[int, int] = {}
    for i in range(count):
        if i in merged_into:
            continue
        for j in range(i + 1, count):
            if j in merged_into:
                continue
            if (observations[i]["chunk_id"] == observations[j]["chunk_id"]
                    and similarity[i][j] >= dedupe_threshold):
                merged_into[j] = i

    live = [i for i in range(count) if i not in merged_into]
    index_of = {original: position for position, original in enumerate(live)}

    sub = similarity[np.ix_(live, live)]
    n = len(live)
    genericness = (sub - np.eye(n)).sum(axis=1) / max(n - 1, 1)
    distinctive = genericness < generic_threshold

    cluster_of = list(range(n))
    members = {i: [i] for i in range(n)}
    pairs = [
        (sub[i][j], i, j)
        for i in range(n) for j in range(i + 1, n)
        if sub[i][j] >= link_threshold
        and observations[live[i]]["chunk_id"] != observations[live[j]]["chunk_id"]
        and distinctive[i] and distinctive[j]
    ]
    for _score, i, j in sorted(pairs, key=lambda p: -p[0]):
        a, b = cluster_of[i], cluster_of[j]
        if a == b:
            continue
        chunks_a = {observations[live[m]]["chunk_id"] for m in members[a]}
        chunks_b = {observations[live[m]]["chunk_id"] for m in members[b]}
        if chunks_a & chunks_b:
            continue
        members[a].extend(members[b])
        for m in members[b]:
            cluster_of[m] = a
        del members[b]

    groups = []
    for indices in sorted(members.values(), key=min):
        originals = [live[i] for i in indices]
        originals += [dup for dup, target in merged_into.items() if target in originals]
        groups.append(sorted(set(originals)))

    full_genericness = np.zeros(count)
    for original, position in index_of.items():
        full_genericness[original] = genericness[position]
    return groups, full_genericness


class EntityAggregator:
    """Links person observations across chunks into individuals.

    Identity is decided by embedding the appearance descriptions and clustering
    them under two constraints, not by asking a model to match people. Given a
    pair of vague descriptions an LLM will confidently declare them the same
    person; measured on this data, provably-different people (co-visible in one
    chunk, so they cannot be the same) reached 0.941 similarity while known-same
    pairs sat at 0.889-0.915. Those bands overlap, so no threshold alone works
    and the constraints do the heavy lifting:

      cannot-link  - two people visible in the same chunk are different people
      distinctness - a description that resembles everything ("dark top, dark
                     pants") identifies nobody, so its owner is left unlinked
                     rather than merged into whoever it drifted closest to

    The LLM is used only afterwards, to write each person's story - which is
    what it is actually good at.
    """

    id = "entities"
    depends_on = ("people",)

    def __init__(
        self,
        model: str | None = None,
        link_threshold: float = 0.88,
        generic_threshold: float = 0.80,
        dedupe_threshold: float = 0.95,
        narrate_min_appearances: int = 2,
        max_narratives: int = 12,
    ):
        self.model = model
        self.link_threshold = link_threshold
        self.generic_threshold = generic_threshold
        self.dedupe_threshold = dedupe_threshold
        self.narrate_min_appearances = narrate_min_appearances
        self.max_narratives = max_narratives

    def _observations(self, ctx: AggregateContext) -> list[dict]:
        observations = []
        for chunk in ctx.chunks("people"):
            for person in chunk["people"].get("people", []):
                signature = (person.get("clothing") or person.get("appearance") or "").strip()
                if not signature:
                    continue
                observations.append({
                    "chunk_id": chunk["id"],
                    "start": chunk["start"],
                    "end": chunk["end"],
                    "box_id": person.get("box_id"),
                    "signature": signature,
                    "role": person.get("role", ""),
                    "action": person.get("action", ""),
                    "clothing": person.get("clothing", ""),
                })
        return observations

    def aggregate(self, ctx: AggregateContext) -> dict | None:
        observations = self._observations(ctx)
        if len(observations) < 2:
            return None

        vectors = get_embedder().embed_documents([o["signature"] for o in observations])
        similarity = vectors @ vectors.T
        count = len(observations)

        merged_into: dict[int, int] = {}
        for i in range(count):
            if i in merged_into:
                continue
            for j in range(i + 1, count):
                if j in merged_into:
                    continue
                if (observations[i]["chunk_id"] == observations[j]["chunk_id"]
                        and similarity[i][j] >= self.dedupe_threshold):
                    merged_into[j] = i
        if merged_into:
            for j, i in merged_into.items():
                if len(observations[j]["signature"]) > len(observations[i]["signature"]):
                    observations[i]["signature"] = observations[j]["signature"]
            observations = [o for k, o in enumerate(observations) if k not in merged_into]
            vectors = get_embedder().embed_documents([o["signature"] for o in observations])
            similarity = vectors @ vectors.T
            count = len(observations)

        off_diagonal = similarity - np.eye(count)
        genericness = off_diagonal.sum(axis=1) / max(count - 1, 1)
        distinctive = genericness < self.generic_threshold

        cluster_of = list(range(count))
        members = {i: [i] for i in range(count)}

        pairs = [
            (similarity[i][j], i, j)
            for i in range(count) for j in range(i + 1, count)
            if similarity[i][j] >= self.link_threshold
            and observations[i]["chunk_id"] != observations[j]["chunk_id"]
            and distinctive[i] and distinctive[j]
        ]
        for _score, i, j in sorted(pairs, key=lambda p: -p[0]):
            a, b = cluster_of[i], cluster_of[j]
            if a == b:
                continue
            chunks_a = {observations[m]["chunk_id"] for m in members[a]}
            chunks_b = {observations[m]["chunk_id"] for m in members[b]}
            if chunks_a & chunks_b:
                continue
            members[a].extend(members[b])
            for m in members[b]:
                cluster_of[m] = a
            del members[b]

        entities = []
        for index, (_root, indices) in enumerate(sorted(members.items(), key=lambda kv: min(kv[1]))):
            group = [observations[i] for i in sorted(indices, key=lambda i: observations[i]["start"])]
            chunk_ids = sorted({o["chunk_id"] for o in group})
            entities.append({
                "entity_id": f"{ctx.video_id[:8]}-p{index:03d}",
                "video_id": ctx.video_id,
                "appearances": len(group),
                "chunk_ids": chunk_ids,
                "first_seen": min(o["start"] for o in group),
                "last_seen": max(o["end"] for o in group),
                "roles": sorted({o["role"] for o in group if o["role"]}),
                "signature": max((o["signature"] for o in group), key=len),
                "distinctive": bool(distinctive[indices[0]]),
                "observations": [
                    {k: o[k] for k in ("chunk_id", "start", "end", "clothing", "role", "action")}
                    for o in group
                ],
            })

        entities.sort(key=lambda e: (-e["appearances"], e["first_seen"]))

        narrated = 0
        for entity in entities:
            if entity["appearances"] < self.narrate_min_appearances or narrated >= self.max_narratives:
                continue
            lines = "\n".join(
                f"[{o['start']:.0f}-{o['end']:.0f}s] {o['clothing']} | {o['role']} | {o['action']}"
                for o in entity["observations"]
            )
            try:
                story = complete(
                    NARRATIVE_PROMPT.format(observations=lines),
                    schema=NARRATIVE_SCHEMA, model=self.model,
                )
                entity.update(story)
                narrated += 1
            except Exception as exc:
                entity["narrative"] = f"ERROR: {type(exc).__name__}: {exc}"

        linked = [e for e in entities if e["appearances"] > 1]
        return {
            "entities": entities,
            "total": len(entities),
            "linked": len(linked),
            "unlinked": len(entities) - len(linked),
            "observations": len(observations),
            "narrated": narrated,
            "params": {
                "link_threshold": self.link_threshold,
                "generic_threshold": self.generic_threshold,
            },
        }


class EntityTimelineAggregator:
    """Presence and dwell time per person."""

    id = "entity_timelines"
    depends_on = ("entities",)

    def aggregate(self, ctx: AggregateContext) -> dict | None:
        entities = (ctx.results.get("entities") or {}).get("entities")
        if not entities:
            return None

        timelines = []
        for entity in entities:
            spans = [(o["start"], o["end"]) for o in entity["observations"]]
            observed = sum(end - start for start, end in spans)
            timelines.append({
                "entity_id": entity["entity_id"],
                "description": entity.get("description") or entity["signature"][:80],
                "role": entity.get("role") or (entity["roles"][0] if entity["roles"] else ""),
                "first_seen": entity["first_seen"],
                "last_seen": entity["last_seen"],
                "span_seconds": round(entity["last_seen"] - entity["first_seen"], 2),
                "observed_seconds": round(observed, 2),
                "appearances": entity["appearances"],
                "chunk_ids": entity["chunk_ids"],
                "spans": [{"start": s, "end": e} for s, e in spans],
            })

        timelines.sort(key=lambda t: -t["observed_seconds"])
        longest = timelines[0] if timelines else None
        return {
            "timelines": timelines,
            "longest_present": {k: longest[k] for k in ("entity_id", "description", "observed_seconds")}
            if longest else None,
        }


class CooccurrenceAggregator:
    """Which people appear together, and which objects appear with them."""

    id = "cooccurrence"
    depends_on = ("entities",)

    def aggregate(self, ctx: AggregateContext) -> dict | None:
        entities = (ctx.results.get("entities") or {}).get("entities")
        if not entities:
            return None

        by_chunk: dict[int, list[str]] = {}
        for entity in entities:
            for chunk_id in entity["chunk_ids"]:
                by_chunk.setdefault(chunk_id, []).append(entity["entity_id"])

        pairs: dict[tuple[str, str], list[int]] = {}
        for chunk_id, ids in by_chunk.items():
            for i in range(len(ids)):
                for j in range(i + 1, len(ids)):
                    pairs.setdefault(tuple(sorted((ids[i], ids[j]))), []).append(chunk_id)

        described = {e["entity_id"]: (e.get("description") or e["signature"][:60]) for e in entities}
        together = sorted(
            (
                {
                    "a": a, "b": b,
                    "a_description": described.get(a, ""),
                    "b_description": described.get(b, ""),
                    "chunks": sorted(chunk_ids),
                    "count": len(chunk_ids),
                }
                for (a, b), chunk_ids in pairs.items()
            ),
            key=lambda p: -p["count"],
        )

        objects: dict[str, int] = {}
        for chunk in ctx.chunks("object_detection"):
            for name in chunk["object_detection"].get("objects", []):
                objects[name] = objects.get(name, 0) + 1

        return {
            "pairs": together[:50],
            "pair_count": len(together),
            "people_per_chunk": {str(k): len(v) for k, v in sorted(by_chunk.items())},
            "objects_present": sorted(objects.items(), key=lambda kv: -kv[1])[:20] or None,
        }
