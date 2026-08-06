import cv2

POSTER_AT = 0.1

MAX_WIDTH = 640

JPEG_QUALITY = 82


def duration_of(video_path: str) -> float:
    """Length in seconds, from the container rather than from the chunks.

    `get_video` derives duration from the last chunk's end, which is the same
    number only when chunking covered the whole video. This is the real one,
    and it is available before any chunking has happened.
    """
    cap = cv2.VideoCapture(video_path)
    try:
        fps = cap.get(cv2.CAP_PROP_FPS)
        frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)
        if not fps or fps <= 0 or not frames or frames <= 0:
            return 0.0
        return round(frames / fps, 3)
    finally:
        cap.release()


def poster_bytes(video_path: str, at: float | None = None) -> bytes | None:
    """One frame as JPEG, or None if the video cannot be decoded.

    Returning None rather than raising is deliberate: a missing poster is a
    cosmetic problem, and a video that analysed fine must not fail its ingest
    because a thumbnail could not be written.
    """
    cap = cv2.VideoCapture(video_path)
    try:
        if not cap.isOpened():
            return None

        fps = cap.get(cv2.CAP_PROP_FPS)
        frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)
        if at is None and fps and fps > 0 and frames and frames > 0:
            at = (frames / fps) * POSTER_AT
        if at:
            cap.set(cv2.CAP_PROP_POS_MSEC, at * 1000)

        ok, frame = cap.read()
        if not ok or frame is None:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ok, frame = cap.read()
            if not ok or frame is None:
                return None

        height, width = frame.shape[:2]
        if width > MAX_WIDTH:
            scale = MAX_WIDTH / width
            frame = cv2.resize(
                frame,
                (MAX_WIDTH, max(1, int(height * scale))),
                interpolation=cv2.INTER_AREA,
            )

        ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
        return buffer.tobytes() if ok else None
    finally:
        cap.release()
