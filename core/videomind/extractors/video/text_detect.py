import cv2
import numpy as np

_reader = None

Box = tuple[int, int, int, int]  # x1, y1, x2, y2


def _get_reader():
    """EasyOCR reader, loaded once. Detection only - the recognition model is
    never run here, which is what makes this cheap enough to use as a gate."""
    global _reader
    if _reader is None:
        import easyocr

        _reader = easyocr.Reader(["en"], gpu=True, verbose=False)
    return _reader


def detect_boxes(frame_rgb: np.ndarray, min_size: int = 12) -> list[Box]:
    """Where is there text in this frame? Returns axis-aligned boxes.

    Uses EasyOCR's detector without its recognition stage: we only need to
    know that text exists and where, then a VLM reads it properly. EasyOCR's
    own recognition is weaker on low-contrast overlays and fragments lines.
    """
    reader = _get_reader()
    bgr = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)
    horizontal, free = reader.detect(bgr, min_size=min_size)

    boxes: list[Box] = []
    # Both come back batched (one entry per input image).
    for x_min, x_max, y_min, y_max in (horizontal[0] if horizontal else []):
        boxes.append((int(x_min), int(y_min), int(x_max), int(y_max)))
    for polygon in (free[0] if free else []):
        points = np.array(polygon, dtype=np.float32)
        x, y, w, h = cv2.boundingRect(points)
        boxes.append((int(x), int(y), int(x + w), int(y + h)))

    return boxes


def annotate(frame_rgb: np.ndarray, boxes: list[Box], colour=(255, 32, 32), width: int = 2):
    """Draw the detected regions so the VLM's attention is pointed at them."""
    marked = frame_rgb.copy()
    for x1, y1, x2, y2 in boxes:
        cv2.rectangle(marked, (x1, y1), (x2, y2), colour, width)
    return marked


def layout_signature(boxes: list[Box], grid: int = 24) -> frozenset:
    """Coarse fingerprint of where text sits in the frame.

    Complements image similarity for de-duplication: when on-screen text
    changes but the scene does not (a counter ticking, a caption swapping),
    frames stay visually near-identical and an image-similarity check alone
    would discard the new text.
    """
    return frozenset(
        ((x1 + x2) // 2 // grid, (y1 + y2) // 2 // grid, (x2 - x1) // grid)
        for x1, y1, x2, y2 in boxes
    )


def layout_changed(previous: frozenset, current: frozenset, tolerance: float = 0.35) -> bool:
    """True when enough text regions appeared or moved to be worth another look."""
    if not previous and not current:
        return False
    if not previous or not current:
        return True
    overlap = len(previous & current) / max(len(previous), len(current))
    return (1.0 - overlap) > tolerance
