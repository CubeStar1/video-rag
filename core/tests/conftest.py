"""Shared fixtures.

Two things have to happen before `videomind` is imported anywhere, which is why
they happen at module level here rather than in a fixture:

1. `paths.py` reads every `VIDEOMIND_*` variable at import time, so redirecting
   the data directory afterwards has no effect. A test run must never write into
   the real `core/data/`.
2. Model and GPU work is opt-in. Importing the package is already slow (torch,
   pyannote, open-clip); nothing here should also download weights.

The suite deliberately tests the *seams* the design document claims are load-
bearing -- the registries, the filter declaration, the vector key, the detail
levels -- rather than the analyzers themselves, which need a GPU and a live
model provider and are covered by the manual cases instead.
"""

import hashlib
import os
import re
import sys
import tempfile
from pathlib import Path

_TEST_DATA = Path(tempfile.mkdtemp(prefix="videomind-tests-"))
os.environ["VIDEOMIND_DATA"] = str(_TEST_DATA)
os.environ["VIDEOMIND_RECORDS"] = str(_TEST_DATA / "records")
os.environ["VIDEOMIND_VECTORDB"] = str(_TEST_DATA / "vectordb")
os.environ["VIDEOMIND_UPLOADS"] = str(_TEST_DATA / "uploads")
os.environ["VIDEOMIND_CACHE"] = str(_TEST_DATA / "cache")
os.environ["VIDEOMIND_MODELS"] = str(_TEST_DATA / "models")
os.environ["VIDEOMIND_UI"] = "0"

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402
import pytest  # noqa: E402


EMBED_DIM = 64


def _embed(text: str) -> np.ndarray:
    """Hashed bag of words, L2-normalised.

    Not a real embedder, but it has the one property the store tests depend on:
    texts sharing words land close together under cosine distance, and texts
    sharing none do not. That is enough to assert ranking, filtering and score
    thresholds without loading BGE or touching the network.
    """
    vector = np.zeros(EMBED_DIM, dtype=np.float32)
    for token in re.findall(r"[a-z0-9]+", text.lower()):
        index = int(hashlib.sha1(token.encode()).hexdigest(), 16) % EMBED_DIM
        vector[index] += 1.0
    norm = float(np.linalg.norm(vector))
    if norm == 0.0:
        vector[0] = 1.0
        return vector
    return vector / norm


class FakeEmbedder:
    dim = EMBED_DIM

    def __init__(self):
        self.documents_embedded = 0
        self.queries_embedded = 0

    def embed_documents(self, texts, batch_size: int = 64) -> np.ndarray:
        self.documents_embedded += len(texts)
        if not texts:
            return np.zeros((0, EMBED_DIM), dtype=np.float32)
        return np.vstack([_embed(t) for t in texts])

    def embed_query(self, text: str) -> np.ndarray:
        self.queries_embedded += 1
        return _embed(text)


@pytest.fixture
def embedder():
    return FakeEmbedder()


@pytest.fixture
def chunk_store(tmp_path, embedder, monkeypatch):
    """A real embedded Qdrant collection with a fake embedder in front of it.

    Real Qdrant on purpose: the point key, the named vector spaces and the
    scoped delete are the behaviours under test, and a mocked store would only
    assert that the test's own mock was called.
    """
    from videomind.vectordb import store as store_module

    monkeypatch.setattr(store_module, "get_embedder", lambda *a, **k: embedder)
    store = store_module.ChunkStore(path=str(tmp_path / "qdrant"))
    try:
        yield store
    finally:
        store.close()


def make_chunk(chunk_id: int, start: float, end: float, **outputs) -> dict:
    return {"id": chunk_id, "start": start, "end": end, **outputs}


def scene(description: str, **extra) -> dict:
    """A `default_video` analyzer output, shaped as the store expects it."""
    return {
        "description": description,
        "setting": extra.get("setting", "supermarket aisle"),
        "people": extra.get("people", []),
        "objects": extra.get("objects", []),
        "actions": extra.get("actions", []),
        "tags": extra.get("tags", []),
        "people_count": extra.get("people_count", len(extra.get("people", []))),
    }


def indexable(chunk_id: int, start: float, end: float, output: dict) -> dict:
    """What `ChunkStore.add_chunks` wants: the output plus its rendered fields."""
    from videomind.vectordb.render import render_structured_scene

    return {
        "id": chunk_id,
        "start": start,
        "end": end,
        "output": output,
        "fields": render_structured_scene(output),
    }


@pytest.fixture
def sample_record(tmp_path):
    """A minimal on-disk record, as `store.build` + `store.attach` would leave it."""
    return {
        "video_id": "abc123def4567890",
        "video_url": "https://example.invalid/storage/videos/abc123def4567890/clip.mp4",
        "storage_path": "abc123def4567890/clip.mp4",
        "source_url": None,
        "filename": "clip.mp4",
        "preset": "audio_video",
        "params": {"min_duration": 5.0, "max_duration": 20.0},
        "chunk_config": "audio_video:5-20",
        "duration": 30.0,
        "analyzers": ["default_video", "people"],
        "chunks": [
            make_chunk(
                0, 0.0, 10.0,
                default_video=scene("A shopper enters the aisle", objects=["trolley"]),
                people={
                    "people": ["a man in a red jacket"],
                    "people_count": 1,
                    "locations": [{"box_id": 1, "xyxy": [0, 0, 10, 10]}],
                    "_debug": "should never be returned",
                },
            ),
            make_chunk(
                1, 10.0, 20.0,
                default_video=scene("The shopper reaches for a shelf", objects=["shelf"]),
            ),
            make_chunk(
                2, 20.0, 30.0,
                default_video=scene("The aisle is empty", objects=[]),
                people={"people": [], "people_count": 0},
            ),
        ],
    }


@pytest.fixture
def record_on_disk(sample_record):
    """`sample_record` written where `record_path_for` will find it."""
    from videomind.api import core as api_core

    api_core.RECORDS_DIR.mkdir(parents=True, exist_ok=True)
    path = api_core.RECORDS_DIR / f"{sample_record['video_id']}.json"
    import json

    path.write_text(json.dumps(sample_record), encoding="utf-8")
    try:
        yield sample_record
    finally:
        path.unlink(missing_ok=True)


@pytest.fixture
def client():
    """FastAPI test client. No token configured, so routes are open."""
    from fastapi.testclient import TestClient

    from videomind.api.app import app

    with TestClient(app) as test_client:
        yield test_client
