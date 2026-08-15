from scenedetect import ContentDetector, detect
from scenedetect.frame_timecode import FrameTimecode

SceneList = list[tuple[FrameTimecode, FrameTimecode]]


def detect_cuts(video_path: str) -> SceneList:
    """Detect hard cuts / transitions. Purely algorithmic (frame-difference
    thresholding) - no model weights involved."""
    return detect(video_path, ContentDetector())


def cut_boundaries(scene_list: SceneList) -> list[tuple[float, float]]:
    """Boundary at each hard cut (i.e. the start of every scene after the first).

    Strength is always 1.0: PySceneDetect's ContentDetector already applies
    its own threshold, so anything it reports is a confident cut.
    """
    return [(start.get_seconds(), 1.0) for start, _end in scene_list[1:]]
