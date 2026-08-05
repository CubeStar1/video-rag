from .base import AggregateContext


class SpeakerStatsAggregator:
    """Who spoke, how much, and how the conversation was shaped.

    Entirely derived from diarization turns already on disk, so it costs
    nothing and answers questions retrieval handles badly: who dominated, who
    barely spoke, where the back-and-forth was densest.
    """

    id = "speaker_stats"
    depends_on = ("diarization",)

    def aggregate(self, ctx: AggregateContext) -> dict | None:
        turns = [
            {**turn, "chunk_id": chunk["id"]}
            for chunk in ctx.chunks("diarization")
            for turn in chunk["diarization"].get("turns", [])
        ]
        if not turns:
            return None
        turns.sort(key=lambda t: t["start"])

        per_speaker: dict[str, dict] = {}
        for turn in turns:
            speaker = turn["speaker"]
            entry = per_speaker.setdefault(speaker, {
                "speaker": speaker, "turns": 0, "seconds": 0.0, "words": 0,
                "first_seen": turn["start"], "last_seen": turn["end"],
                "longest_turn": 0.0, "chunks": set(),
            })
            length = turn["end"] - turn["start"]
            entry["turns"] += 1
            entry["seconds"] += length
            entry["words"] += len(turn.get("text", "").split())
            entry["last_seen"] = max(entry["last_seen"], turn["end"])
            entry["longest_turn"] = max(entry["longest_turn"], length)
            entry["chunks"].add(turn["chunk_id"])

        total = sum(e["seconds"] for e in per_speaker.values()) or 1.0
        speakers = []
        for entry in per_speaker.values():
            speakers.append({
                **entry,
                "seconds": round(entry["seconds"], 2),
                "longest_turn": round(entry["longest_turn"], 2),
                "share": round(entry["seconds"] / total, 3),
                "words_per_second": round(entry["words"] / entry["seconds"], 2) if entry["seconds"] else 0,
                "chunks": sorted(entry["chunks"]),
            })
        speakers.sort(key=lambda s: -s["seconds"])

        # A handover is one speaker following another; counting them separates
        # a rapid exchange from two people taking long uninterrupted turns.
        handovers = sum(1 for a, b in zip(turns, turns[1:]) if a["speaker"] != b["speaker"])

        return {
            "speakers": speakers,
            "speaker_count": len(speakers),
            "total_turns": len(turns),
            "handovers": handovers,
            "total_speech_seconds": round(total, 2),
            "dominant_speaker": speakers[0]["speaker"] if speakers else None,
            "timeline": [
                {"start": t["start"], "end": t["end"], "speaker": t["speaker"]}
                for t in turns
            ],
        }
