import json
from pathlib import Path

Chunks = list[tuple[float, float]]


def build(media: dict, chunks: Chunks, preset: str | None = None, **params) -> dict:
    """Wrap raw (start, end) pairs into the on-disk chunk record.

    `media` is what `storage.fetch_source`/`put_local` returned. The record
    stores the video's Storage identity and never its local path: the cached
    file is derived from `video_id` on demand, so a record stays correct after
    the data directory moves or the cache is wiped.
    """
    return {
        "video_id": media["video_id"],
        "video_url": media["video_url"],
        "storage_path": media["storage_path"],
        "source_url": media.get("source_url"),
        "filename": media["filename"],
        "preset": preset,
        "params": params,
        "chunks": [
            {"id": i, "start": round(start, 3), "end": round(end, 3)}
            for i, (start, end) in enumerate(chunks)
        ],
    }


def save(record: dict, path: str) -> None:
    Path(path).write_text(json.dumps(record, indent=2), encoding="utf-8")


def load(path: str) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def attach(record: dict, chunk_id: int, **fields) -> None:
    """Attach extractor output (transcript, description, ...) to one chunk, in place."""
    record["chunks"][chunk_id].update(fields)
