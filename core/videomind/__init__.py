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

from .chunk import chunk_video
from .chunking import audio_chunk, audio_video_chunk, video_chunk

__all__ = ["audio_chunk", "video_chunk", "audio_video_chunk", "chunk_video"]
