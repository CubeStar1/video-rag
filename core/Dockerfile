# FalconVQA core — CPU-only image.
#
# Build:  docker build -t videomind-core core/
#
# Torch comes from PyTorch's *cpu* index, not PyPI: the PyPI Linux wheel is the
# CUDA build and drags in ~2.5 GB of nvidia-* runtime packages that nothing
# here would use. This keeps the image around 2 GB instead of 10.
#
# Every model already falls back to CPU on its own (`torch.cuda.is_available()`
# is simply False), so no application code changes. EasyOCR is the one
# exception: text_detect.py passes gpu=True unconditionally, which warns and
# then falls back — noisy, not fatal.

FROM python:3.13-slim-bookworm

# uv is the installer; it resolves and unpacks this dependency set several
# times faster than pip. Pin the tag once you have a version you trust.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# ffmpeg is the binary, not the libraries — PyAV bundles those. Without it a
# YouTube ingest silently falls back to 360p (see CLAUDE.md), so installing it
# here is the one thing this image does better than the Windows dev box.
# libgl1/libglib2.0-0 are opencv-python's; libsndfile1 is soundfile's.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        libgl1 \
        libglib2.0-0 \
        libsndfile1 \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV UV_SYSTEM_PYTHON=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_NO_CACHE=1

# Torch in its own layer: it is the largest single download and changes far
# less often than the rest of the set.
#
# Installed from requirements.txt's pins rather than `uv sync`, because
# pyproject.toml's [tool.uv.sources] routes torch to the CUDA 13 index on
# Linux — correct for the dev box, wrong for this image.
RUN uv pip install --index-url https://download.pytorch.org/whl/cpu \
        torch==2.11.0 torchvision==0.26.0 torchaudio==2.11.0

COPY requirements.txt ./
# `torch` is unpinned in requirements.txt precisely so this step leaves the
# CPU build above in place instead of pulling the CUDA one from PyPI.
RUN uv pip install -r requirements.txt

COPY . .

# YOLO weights are baked in and kept OUT of /data: object_detect.py reads them
# from MODEL_DIR, and /data is a mounted volume that would shadow anything the
# image put there. Everything genuinely stateful goes under /data instead.
RUN mkdir -p /opt/models && mv yolo11n.pt /opt/models/ 2>/dev/null || true

ENV VIDEOMIND_DATA=/data \
    VIDEOMIND_MODELS=/opt/models \
    HF_HOME=/data/hf \
    TORCH_HOME=/data/torch \
    EASYOCR_MODULE_PATH=/data/easyocr \
    PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    USE_TF=0 \
    TF_CPP_MIN_LOG_LEVEL=3

# uid 1000 is fixed so the host can `chown -R 1000:1000` the data disk once at
# provisioning time and the container never needs to run as root to write it.
RUN useradd --uid 1000 --create-home app \
    && mkdir -p /data \
    && chown -R app:app /data /opt/models /app
USER app

EXPOSE 8077

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8077/health || exit 1

# One worker, not negotiable: the embedded Qdrant store takes an exclusive
# file lock on data/vectordb (vectordb/store.py), so a second worker in the
# same container would fail every request that opens a ChunkStore.
CMD ["uvicorn", "videomind.api.app:app", \
     "--host", "0.0.0.0", "--port", "8077", "--workers", "1"]
