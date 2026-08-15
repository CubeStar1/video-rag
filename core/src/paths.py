import os
from pathlib import Path

ROOT = Path(os.environ.get("VIDEOMIND_ROOT", Path(__file__).resolve().parent.parent))

DATA_DIR = Path(os.environ.get("VIDEOMIND_DATA", ROOT / "data"))

RECORDS_DIR = Path(os.environ.get("VIDEOMIND_RECORDS", DATA_DIR / "records"))
VECTOR_DIR = Path(os.environ.get("VIDEOMIND_VECTORDB", DATA_DIR / "vectordb"))

UPLOAD_DIR = Path(os.environ.get("VIDEOMIND_UPLOADS", DATA_DIR / "uploads"))

CACHE_DIR = Path(os.environ.get("VIDEOMIND_CACHE", DATA_DIR / "cache"))

MEDIA_DIR = Path(os.environ.get("VIDEOMIND_MEDIA", ROOT / "media"))

MODEL_DIR = Path(os.environ.get("VIDEOMIND_MODELS", DATA_DIR / "models"))

STATIC_DIR = Path(__file__).resolve().parent / "api" / "static"


def ensure() -> None:
    """Create the writable directories if they are missing."""
    for directory in (DATA_DIR, RECORDS_DIR, UPLOAD_DIR, CACHE_DIR, MODEL_DIR):
        directory.mkdir(parents=True, exist_ok=True)
