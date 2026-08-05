import json
from pathlib import Path

Chunks = list[tuple[float, float]]


def build(video_path: str, chunks: Chunks, preset: str | None = None, **params) -> dict:
    """Wrap raw (start, end) pairs into the on-disk chunk record."""
    return {
        "video": str(video_path),
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
