import os as _os
import warnings as _warnings

_os.environ.setdefault("USE_TF", "0")
_os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
_os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")

_warnings.filterwarnings("ignore", message=r"(?s).*torchcodec.*")


def _register_cuda12_dlls() -> None:

    if not hasattr(_os, "add_dll_directory"):
        return
    try:
        import nvidia  # noqa: PLC0415 - optional, and only present on CUDA installs
    except ImportError:
        return

    for package in nvidia.__path__:
        for component in ("cublas", "cuda_nvrtc", "cudnn"):
            binaries = _os.path.join(package, component, "bin")
            if _os.path.isdir(binaries):
                _os.add_dll_directory(binaries)


_register_cuda12_dlls()

from .chunk import chunk_video
from .chunking import audio_chunk, audio_video_chunk, video_chunk

__all__ = ["audio_chunk", "video_chunk", "audio_video_chunk", "chunk_video"]
