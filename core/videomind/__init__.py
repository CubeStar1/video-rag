import os as _os
import warnings as _warnings

# Set before anything below imports transformers or pyannote. This is the
# package root, so it runs first no matter how the app is started - putting it
# only in api/app.py was too late, because `uvicorn videomind.api.app:app`
# imports this package before that module.
#
# transformers probes for TensorFlow and imports it when present, dragging in
# oneDNN/absl banners and seconds of startup for a backend nothing here uses.
_os.environ.setdefault("USE_TF", "0")
_os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
_os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")

# pyannote warns at import that torchcodec cannot load its FFmpeg DLLs. Audio
# is decoded with PyAV and handed to pyannote in memory, so torchcodec is never
# used and the warning is noise. Filtered by message rather than blanket-
# ignoring, so real warnings still surface.
# The (?s) matters: filterwarnings anchors the pattern with re.match, and this
# warning's text begins with a newline that a bare ".*" will not cross.
_warnings.filterwarnings("ignore", message=r"(?s).*torchcodec.*")


def _register_cuda12_dlls() -> None:
    """Make the CUDA 12 runtime loadable on Windows, for CTranslate2 only.

    faster-whisper does not run on torch - it runs on CTranslate2, which is
    built against **CUDA 12** and loads `cublas64_12.dll` by name. Torch here is
    cu130 and ships `cublas64_13.dll`, a different filename, so it can never
    satisfy that link no matter what is on PATH. The `nvidia-cublas-cu12`
    package supplies the missing DLL.

    Registering the directory is the part that is easy to miss: since Python
    3.8, Windows resolves an extension module's dependencies through
    `LOAD_LIBRARY_SEARCH_DEFAULT_DIRS`, which does **not** include PATH. So
    installing the package is necessary and not sufficient - without this the
    DLL sits in site-packages and the loader still reports it as not found.
    Torch does the same thing for its own `torch/lib`; CTranslate2 does not.

    Runs at package import, before any analyzer can pull in faster_whisper.
    A no-op off Windows, where the wheel's RPATH handles it.
    """
    if not hasattr(_os, "add_dll_directory"):
        return
    try:
        import nvidia  # noqa: PLC0415 - optional, and only present on CUDA installs
    except ImportError:
        return  # CPU-only install; the CPU path needs no CUDA runtime at all

    for package in nvidia.__path__:
        for component in ("cublas", "cuda_nvrtc", "cudnn"):
            binaries = _os.path.join(package, component, "bin")
            if _os.path.isdir(binaries):
                _os.add_dll_directory(binaries)


_register_cuda12_dlls()

from .chunk import chunk_video
from .chunking import audio_chunk, audio_video_chunk, video_chunk

__all__ = ["audio_chunk", "video_chunk", "audio_video_chunk", "chunk_video"]
