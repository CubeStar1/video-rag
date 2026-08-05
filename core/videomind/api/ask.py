"""Question answering over a video's chunks and aggregates.

`/query` retrieves segments. This answers questions, which needs more than one
kind of source: "what did the woman in light gray do" is answered by the entity
narratives, "which part is unusual" by novelty, "how busy was it" by stats.
Rather than search chunks and hope, the question is routed to the aggregates
that can actually answer it.
"""

import numpy as np

from ..vectordb import ChunkStore, get_embedder

# What each aggregate is good for, in the words a question would use. These are
# embedded and compared to the question, so routing degrades gracefully on
# phrasings nobody anticipated - and a new aggregator joins simply by adding a
# line here, with no keyword list to maintain.
ROUTE_HINTS = {
    "entities": "what a particular person did; someone identified by their clothing or "
                "appearance; the man in the blue shirt; the woman in grey; follow one "
                "individual through the footage; how long a person stayed",
    "novelty": "which segment is unusual, anomalous, strange, unexpected, out of the "
               "ordinary; what stands out; the part that differs from the rest",
    "stats": "how many people were present; how busy or crowded; the busiest or quietest "
             "moment; counts and totals over time; how long the footage runs",
    "events": "what happened and when; arrivals and departures; transactions; "
              "discrete moments and incidents in time order",
    "chapters": "the structure of the footage; what sections or stages it has; "
                "what the video is about overall",
    "speaker_stats": "who talked the most; how many speakers there were; speaking time; "
                     "number of turns; interruptions in conversation",
    # Narrowed to speech: an earlier, vaguer wording ("how someone sounded") made this
    # out-rank entities for "what did the woman in grey do", which is not about tone.
    "sentiment": "the tone or mood of what was said aloud; whether spoken language was "
                 "positive, negative or neutral; how a speaker's words came across",
    "ner": "named things mentioned: brands, product names, organisations, place names, "
           "people's names, dates and amounts",
    "object_entities": "a particular object followed through the footage; the same "
                       "cart or bag seen more than once; what an item was used for over time",
    "cooccurrence": "which people appeared together at the same time; who was accompanied "
                    "by whom; pairs of people sharing a segment",
}

# Absolute thresholds do not survive contact with real questions: the score
# distribution shifts per question (means of 0.47 to 0.56 measured here), so one
# cutoff either lets everything through or nothing. The ranking is reliable
# though, so selection is relative - how far a hint stands above the average for
# this question - with a hard cap so an ambiguous question cannot pull in
# everything.
ROUTE_Z = 1.0
ROUTE_MAX = 3
MAX_SECTIONS = 4
MAX_ENTITIES = 4

PROMPT = """\
Answer the question using only the material below, which comes from automated \
analysis of video footage.

Cite the evidence for each claim as [video_id start-end], using the timecodes \
given. If the material does not support an answer, say so plainly rather than \
guessing. Do not invent people, times or events that are not listed.

Question: {question}

{context}"""


def _rank(question_vector, texts: list[str]):
    """Similarity of each text to the question."""
    if not texts:
        return []
    vectors = get_embedder().embed_documents(texts)
    return list(vectors @ question_vector)


def route(question: str, available: list[str],
          z: float = ROUTE_Z, cap: int = ROUTE_MAX) -> list[str]:
    """Which aggregates are worth reading for this question.

    Picks the hints standing at least `z` standard deviations above the mean
    for this question, keeping the best `cap`.
    """
    candidates = [a for a in available if a in ROUTE_HINTS]
    if not candidates:
        return []
    question_vector = get_embedder().embed_query(question)
    scores = np.array(_rank(question_vector, [ROUTE_HINTS[a] for a in candidates]))

    spread = float(scores.std()) or 1e-6
    cutoff = float(scores.mean()) + z * spread
    ranked = sorted(zip(candidates, scores), key=lambda p: -p[1])
    chosen = [a for a, s in ranked if s >= cutoff][:cap]
    # Nothing stood out - the question is broad, so answer from the strongest
    # match rather than from nothing.
    if not chosen and ranked:
        chosen = [ranked[0][0]]
    return chosen


def _entity_context(question_vector, entities: list[dict]) -> list[str]:
    """The people whose descriptions best match the question."""
    described = [
        (e, " ".join(filter(None, [e.get("description"), e.get("signature"), e.get("role")])))
        for e in entities
    ]
    scores = _rank(question_vector, [d for _, d in described])
    ranked = sorted(zip(described, scores), key=lambda p: -p[1])[:MAX_ENTITIES]

    lines = []
    for (entity, _), score in ranked:
        story = entity.get("narrative") or ""
        lines.append(
            f"- {entity.get('description') or entity['signature'][:90]} "
            f"(seen {entity['appearances']}x, {entity['first_seen']:.0f}-{entity['last_seen']:.0f}s)"
            + (f"\n    {story}" if story else "")
        )
    return lines


def _section_context(question_vector, summary: dict) -> list[str]:
    """Summary sections closest to the question, finest tier first."""
    sections = summary.get("sections") or []
    if not sections:
        return []
    scores = _rank(question_vector, [s["summary"] for s in sections])
    ranked = sorted(zip(sections, scores), key=lambda p: -p[1])[:MAX_SECTIONS]
    return [f"- [{s['start']:.0f}-{s['end']:.0f}s] {s['summary']}" for s, _ in ranked]


def build_context(question: str, record: dict, hits: list[dict]) -> tuple[str, dict]:
    """Assemble everything worth showing the model, and say where it came from."""
    aggregates = record.get("aggregates", {})
    video_id = record.get("video_id", "")
    question_vector = get_embedder().embed_query(question)
    routed = route(question, sorted(aggregates))

    blocks, used = [], {"routed_to": routed, "chunks": len(hits)}

    if summary := aggregates.get("summary"):
        blocks.append(f"OVERALL SUMMARY of {video_id}:\n{summary.get('summary','')}")
        if sections := _section_context(question_vector, summary):
            blocks.append("RELEVANT SECTIONS:\n" + "\n".join(sections))
            used["sections"] = len(sections)

    if "entities" in routed and (entities := aggregates.get("entities", {}).get("entities")):
        if lines := _entity_context(question_vector, entities):
            blocks.append("PEOPLE IDENTIFIED (linked across segments):\n" + "\n".join(lines))
            used["entities"] = len(lines)

    if "novelty" in routed and (novelty := aggregates.get("novelty")):
        ranked = novelty.get("ranked", [])[:5]
        outliers = {o["chunk_id"] for o in novelty.get("outliers", [])}
        blocks.append("SEGMENTS MOST UNLIKE THE REST (higher = more unusual):\n" + "\n".join(
            f"- [{r['start']:.0f}-{r['end']:.0f}s] novelty {r['novelty']:.3f}"
            f"{' (statistical outlier)' if r['chunk_id'] in outliers else ''}: {r['description'][:150]}"
            for r in ranked))
        used["novelty"] = len(ranked)

    if "stats" in routed and (stats := aggregates.get("stats")):
        parts = [f"duration {stats.get('duration')}s over {stats.get('chunks')} segments"]
        if people := stats.get("people"):
            parts.append(
                f"people per segment min {people['min']}, max {people['max']}, mean {people['mean']}; "
                f"busiest {people['busiest']['start']:.0f}-{people['busiest']['end']:.0f}s "
                f"({people['busiest']['count']}), quietest {people['quietest']['start']:.0f}-"
                f"{people['quietest']['end']:.0f}s ({people['quietest']['count']})")
        if speech := stats.get("speech"):
            parts.append(f"speech {speech.get('words')} words over {speech.get('spoken_seconds')}s")
        blocks.append("STATISTICS:\n" + "\n".join(f"- {p}" for p in parts))
        used["stats"] = True

    if "events" in routed and (events := aggregates.get("events", {}).get("events")):
        blocks.append("EVENTS:\n" + "\n".join(
            f"- [{e['start']:.0f}-{e['end']:.0f}s] {e['event']}"
            + (f" ({e['actor']})" if e.get("actor") else "")
            for e in events[:15]))
        used["events"] = min(len(events), 15)

    if "object_entities" in routed and (objects := aggregates.get("object_entities", {}).get("objects")):
        tracked = [o for o in objects if o["appearances"] > 1][:6]
        if tracked:
            blocks.append("OBJECTS TRACKED ACROSS SEGMENTS:\n" + "\n".join(
                f"- {o.get('description') or o['signature'][:80]} "
                f"(seen {o['appearances']}x, {o['first_seen']:.0f}-{o['last_seen']:.0f}s)"
                + (f"\n    {o['narrative']}" if o.get("narrative") else "")
                for o in tracked))
            used["object_entities"] = len(tracked)

    if "chapters" in routed and (chapters := aggregates.get("chapters", {}).get("chapters")):
        blocks.append("CHAPTERS:\n" + "\n".join(
            f"- [{c['start']:.0f}-{c['end']:.0f}s] {c['title']}: {c['summary']}" for c in chapters))
        used["chapters"] = len(chapters)

    if "speaker_stats" in routed and (speakers := aggregates.get("speaker_stats")):
        blocks.append("SPEAKERS:\n" + "\n".join(
            f"- {s['speaker']}: {s['seconds']}s across {s['turns']} turns ({s['share']:.0%} of speech)"
            for s in speakers.get("speakers", [])))
        used["speaker_stats"] = True

    if "sentiment" in routed and (sentiment := aggregates.get("sentiment")):
        blocks.append(
            f"SENTIMENT OF LANGUAGE USED (not inferred emotion): overall {sentiment.get('overall')}"
            + "".join(f"\n- {p['speaker']}: mostly {p['dominant']}"
                      for p in sentiment.get("per_speaker", [])))
        used["sentiment"] = True

    if "ner" in routed and (ner := aggregates.get("ner")):
        blocks.append("NAMED ENTITIES MENTIONED:\n" + "\n".join(
            f"- {label}: {', '.join(items[:10])}" for label, items in ner.get("by_label", {}).items()))
        used["ner"] = True

    if hits:
        blocks.append("MATCHING SEGMENTS:\n" + "\n".join(
            f"- [{h['video_id']} {h['start']:.0f}-{h['end']:.0f}s] "
            f"{(h.get('description') or h.get('text') or h.get('snippet') or '')[:280]}"
            for h in hits))

    return "\n\n".join(blocks), used
