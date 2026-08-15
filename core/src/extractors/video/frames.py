import cv2
import numpy as np


def read_frames(
    video_path: str,
    start: float,
    end: float,
    fps: float = 2.0,
) -> tuple[list[float], list[np.ndarray]]:
    """Read frames from a video between `start` and `end` at `fps`.

    Seeks once to `start`, then walks forward with grab()/retrieve() rather
    than seeking per frame. cv2.CAP_PROP_POS_FRAMES seeking forces the H.264
    decoder back to a keyframe every time (~22x more expensive per frame here);
    grab() skips unwanted frames without paying to decode them.

    Returns (timestamps, RGB frames).
    """
    cap = cv2.VideoCapture(video_path)
    native_fps = cap.get(cv2.CAP_PROP_FPS)
    step = max(1, int(round(native_fps / fps)))

    start_frame = int(start * native_fps)
    end_frame = int(end * native_fps)
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

    timestamps, frames = [], []
    index = start_frame
    while index < end_frame:
        if not cap.grab():
            break
        if (index - start_frame) % step == 0:
            ok, frame = cap.retrieve()
            if not ok:
                break
            timestamps.append(index / native_fps)
            frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        index += 1
    cap.release()

    return timestamps, frames
