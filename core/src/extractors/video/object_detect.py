import cv2
import numpy as np

from ...paths import MODEL_DIR, ensure as ensure_dirs

_model = None
_model_name = None

Detection = tuple[tuple[int, int, int, int], str, float]


def _get_model(name: str = "yolo11n.pt"):
    """YOLO detector, loaded once.

    Weights are kept under the data directory rather than dropped in whatever
    the working directory happened to be, which is where ultralytics puts them
    by default.
    """
    global _model, _model_name
    if _model is None or _model_name != name:
        from ultralytics import YOLO

        ensure_dirs()
        local = MODEL_DIR / name
        _model = YOLO(str(local) if local.exists() else name)
        _model_name = name
    return _model


def detect_objects(
    frame_rgb: np.ndarray,
    confidence: float = 0.35,
    model_name: str = "yolo11n.pt",
) -> list[Detection]:
    """Where are the objects in this frame?

    Used as an attention gate, not as ground truth. YOLO's COCO classes cover
    everyday scenes and nothing else - on thermal footage it called a tank an
    "airplane" at 0.73 confidence - so the labels are kept for de-duplication
    and diagnostics only, and never shown to the VLM.
    """
    model = _get_model(model_name)
    bgr = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)
    result = model(bgr, conf=confidence, verbose=False)[0]

    detections: list[Detection] = []
    for box in result.boxes:
        x1, y1, x2, y2 = (int(v) for v in box.xyxy[0].tolist())
        detections.append(((x1, y1, x2, y2), result.names[int(box.cls)], float(box.conf)))
    return detections


def detect_in_span(ctx, start: float, end: float, fps: float, confidence: float, model_name: str):
    """Detections for every sampled frame of a span, computed once per span.

    Memoised on the VideoContext so the object and people analyzers share a
    single YOLO pass over the same frames instead of each paying for their own.
    """
    key = f"yolo:{model_name}:{confidence:g}:{fps:g}:{start:.3f}:{end:.3f}"

    def run():
        timestamps, frames = ctx.frames(start, end, fps=fps)
        return [
            (t, frame, detect_objects(frame, confidence=confidence, model_name=model_name))
            for t, frame in zip(timestamps, frames)
        ]

    return ctx.memo(key, run)


def iou(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    """Intersection over union of two boxes."""
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    intersection = (ix2 - ix1) * (iy2 - iy1)
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return intersection / float(area_a + area_b - intersection)


def track_ids(
    frames_boxes: list[list[tuple[int, int, int, int]]],
    threshold: float = 0.3,
) -> list[dict[int, tuple[int, int, int, int]]]:
    """Give each subject a number that means the same thing in every frame.

    YOLO returns detections in confidence order, which changes frame to frame,
    so numbering them as they arrive would make "person 3" a different person
    in each image - and any per-number location mapping would be wrong. Boxes
    are therefore matched to the previous frame by overlap and inherit its id.
    """
    tracked: list[dict[int, tuple[int, int, int, int]]] = []
    previous: dict[int, tuple[int, int, int, int]] = {}
    next_id = 1

    for boxes in frames_boxes:
        current: dict[int, tuple[int, int, int, int]] = {}
        unclaimed = dict(previous)
        for box in boxes:
            best_id, best_score = None, threshold
            for candidate_id, candidate_box in unclaimed.items():
                score = iou(box, candidate_box)
                if score >= best_score:
                    best_id, best_score = candidate_id, score
            if best_id is None:
                best_id = next_id
                next_id += 1
            else:
                unclaimed.pop(best_id)
            current[best_id] = box
        tracked.append(current)
        previous = {**previous, **current}

    return tracked


def crop(frame_rgb: np.ndarray, box: tuple[int, int, int, int], pad: int = 4) -> np.ndarray:
    """Cut a detection out of its frame, for embedding or re-identification."""
    height, width = frame_rgb.shape[:2]
    x1, y1, x2, y2 = box
    x1, y1 = max(0, x1 - pad), max(0, y1 - pad)
    x2, y2 = min(width, x2 + pad), min(height, y2 + pad)
    return frame_rgb[y1:y2, x1:x2]


def annotate_numbered(
    frame_rgb: np.ndarray,
    numbered: dict[int, tuple[int, int, int, int]],
    colour=(255, 220, 0),
    width: int = 2,
):
    """Draw already-numbered boxes onto a frame.

    Numbers give the VLM a way to refer to a specific subject, so its
    description can be tied back to an exact box - which is what lets a later
    pass crop that person out and match them across chunks. Unlike a class
    label, a number carries no claim about what the thing is, so it cannot
    bias the identification. Ids must come from `track_ids` so the same number
    means the same subject in every frame.
    """
    marked = frame_rgb.copy()
    for subject_id, (x1, y1, x2, y2) in sorted(numbered.items()):
        cv2.rectangle(marked, (x1, y1), (x2, y2), colour, width)
        cv2.putText(marked, str(subject_id), (x1, max(12, y1 - 6)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, colour, 2, cv2.LINE_AA)
    return marked


def annotate(frame_rgb: np.ndarray, detections: list[Detection], colour=(0, 220, 255), width: int = 2):
    """Box the detected regions.

    Boxes are drawn unlabelled on purpose: a wrong YOLO label written onto the
    image invites the VLM to agree with it, and identifying the object is
    exactly the job being delegated to the VLM.
    """
    marked = frame_rgb.copy()
    for (x1, y1, x2, y2), _label, _conf in detections:
        cv2.rectangle(marked, (x1, y1), (x2, y2), colour, width)
    return marked


def layout_signature(detections: list[Detection], grid: int = 32) -> frozenset:
    """Coarse fingerprint of what is where, for de-duplication.

    Includes the class label so a new kind of object entering the frame counts
    as a change even if it lands where something else was.
    """
    return frozenset(
        (label, (x1 + x2) // 2 // grid, (y1 + y2) // 2 // grid)
        for (x1, y1, x2, y2), label, _conf in detections
    )


def layout_changed(previous: frozenset, current: frozenset, tolerance: float = 0.35) -> bool:
    """True when enough objects appeared, left or moved to be worth another look."""
    if not previous and not current:
        return False
    if not previous or not current:
        return True
    overlap = len(previous & current) / max(len(previous), len(current))
    return (1.0 - overlap) > tolerance
