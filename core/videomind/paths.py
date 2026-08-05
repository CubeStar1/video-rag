"""Where everything lives on disk.

One module so the layout can change without hunting through call sites, and so
runtime state stays under a single directory that is trivial to gitignore or
delete. Every path can be overridden by environment variable, which is what
makes it possible to point a second instance at its own data.
"""

import os
from pathlib import Path

ROOT = Path(os.environ.get("VIDEOMIND_ROOT", Path(__file__).resolve().parent.parent))

# Everything the app writes. Wiping this directory is a full reset.
DATA_DIR = Path(os.environ.get("VIDEOMIND_DATA", ROOT / "data"))

RECORDS_DIR = Path(os.environ.get("VIDEOMIND_RECORDS", DATA_DIR / "records"))
VECTOR_DIR = Path(os.environ.get("VIDEOMIND_VECTORDB", DATA_DIR / "vectordb"))

# Files posted to the API as multipart, on their way to Storage. Kept after the
# upload rather than deleted: this is where a "what did I actually send?"
# question gets answered.
UPLOAD_DIR = Path(os.environ.get("VIDEOMIND_UPLOADS", DATA_DIR / "uploads"))

# Videos pulled back out of Storage to be decoded, keyed by content hash.
# Regenerable - deleting it costs a re-download, never data. Every analyzer
# re-opens the video and frames.py seeks per chunk, so decoding straight from
# a URL would pay the network for what is meant to be a local seek.
CACHE_DIR = Path(os.environ.get("VIDEOMIND_CACHE", DATA_DIR / "cache"))

# Read-only test assets, kept out of DATA_DIR so a reset never deletes them.
MEDIA_DIR = Path(os.environ.get("VIDEOMIND_MEDIA", ROOT / "media"))

# Downloaded model weights (YOLO). Regenerable, so it lives under DATA_DIR
# rather than being committed.
MODEL_DIR = Path(os.environ.get("VIDEOMIND_MODELS", DATA_DIR / "models"))

STATIC_DIR = Path(__file__).resolve().parent / "api" / "static"


def ensure() -> None:
    """Create the writable directories if they are missing."""
    for directory in (DATA_DIR, RECORDS_DIR, UPLOAD_DIR, CACHE_DIR, MODEL_DIR):
        directory.mkdir(parents=True, exist_ok=True)
