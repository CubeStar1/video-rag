"""Rebuild the vector store from saved records/.

Analyzer output is already on disk, so re-embedding costs no API calls.
Use after changing the embedder, an analyzer's render_fields, or the vector
schema.
"""

import sys
from pathlib import Path

# Run from anywhere: scripts live one level below the project root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import json
import os
import shutil
import warnings
from pathlib import Path

os.environ.setdefault("USE_TF", "0")
warnings.filterwarnings("ignore")

from videomind import analyzers
from videomind.api.core import RECORDS_DIR
from videomind.paths import VECTOR_DIR
from videomind.vectordb import ChunkStore

# Rebuilt rather than upserted into: a schema change (e.g. new named vectors)
# is not compatible with the existing collection.
if VECTOR_DIR.exists():
    shutil.rmtree(VECTOR_DIR)

cs = ChunkStore(path=str(VECTOR_DIR))

records = sorted(RECORDS_DIR.glob("*.json")) if RECORDS_DIR.exists() else []
if not records:
    print(f"No records in {RECORDS_DIR}/ - nothing to rebuild.")

for path in records:
    record = json.loads(path.read_text(encoding="utf-8"))
    video_id = record["video_id"]
    video_path = record["video"]
    cfg = record["chunk_config"]

    for analyzer_id in record.get("analyzers", []):
        analyzer = analyzers.get(analyzer_id)
        payload = [
            {
                "id": c["id"],
                "start": c["start"],
                "end": c["end"],
                "output": c[analyzer_id],
                "fields": analyzer.render_fields(c[analyzer_id]),
            }
            for c in record["chunks"]
            if c.get(analyzer_id)
        ]
        n = cs.add_chunks(video_id, video_path, payload, analyzer_id, cfg) if payload else 0
        print(f"{path.stem[:34]:36s} {analyzer_id:14s} {n:3d} points")

print(f"\ntotal points: {cs.count()}")
cs.close()
