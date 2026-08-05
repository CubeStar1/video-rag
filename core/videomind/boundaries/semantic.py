import cv2
import open_clip
import torch
from PIL import Image

_model = None
_preprocess = None
_device = "cuda" if torch.cuda.is_available() else "cpu"


def _get_model():
    global _model, _preprocess
    if _model is None:
        _model, _, _preprocess = open_clip.create_model_and_transforms("ViT-B-32", pretrained="openai")
        _model = _model.to(_device).eval()
    return _model, _preprocess


def embed_images(frames: list) -> torch.Tensor:
    """Embed a list of RGB numpy frames, returning a normalized (n, dim) tensor.

    Shared with the frame samplers so only one CLIP model is ever resident.
    """
    model, preprocess = _get_model()
    if not frames:
        return torch.empty(0)

    batch = torch.stack([preprocess(Image.fromarray(f)) for f in frames]).to(_device)
    with torch.no_grad():
        embeddings = model.encode_image(batch)
        embeddings = embeddings / embeddings.norm(dim=-1, keepdim=True)
    return embeddings


def frame_embeddings(
    video_path: str,
    sample_fps: float = 1.0,
    batch_size: int = 64,
) -> list[tuple[float, torch.Tensor]]:
    """Sample frames at `sample_fps` and return (timestamp, normalized CLIP embedding) pairs.

    Walks the video forward with grab()/retrieve() instead of seeking to each
    timestamp: per-frame seeking makes the H.264 decoder restart from a
    keyframe every time and costs ~22x more per frame than skipping with grab().
    """
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    step = max(1, int(round(fps / sample_fps)))

    timestamps, frames = [], []
    index = 0
    while True:
        if not cap.grab():
            break
        if index % step == 0:
            ok, frame = cap.retrieve()
            if not ok:
                break
            timestamps.append(index / fps)
            frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        index += 1
    cap.release()

    embeddings = []
    for i in range(0, len(frames), batch_size):
        batch = embed_images(frames[i : i + batch_size])
        embeddings.extend(batch[j : j + 1] for j in range(len(batch)))

    return list(zip(timestamps, embeddings))


def semantic_boundaries(embeddings: list[tuple[float, torch.Tensor]]) -> list[tuple[float, float]]:
    """Boundary between consecutive sampled frames, strength = how dissimilar they are.

    Raw strength is (1 - cosine_similarity). Unlike pyannote/PySceneDetect,
    which emit sparse 1.0-strength events, CLIP similarity drifts continuously
    and rarely gets close to 0 even at a real semantic jump. So strengths are
    rescaled relative to the clip's own biggest jump, putting the strongest
    semantic change in this clip on equal footing with a speaker change or a
    hard cut (as opposed to always being diluted by weight alone).
    """
    raw = []
    for (t0, e0), (t1, e1) in zip(embeddings, embeddings[1:]):
        similarity = (e0 @ e1.T).item()
        midpoint = (t0 + t1) / 2
        raw.append((midpoint, max(0.0, 1.0 - similarity)))

    peak = max((strength for _, strength in raw), default=0.0)
    if peak == 0.0:
        return raw

    return [(t, strength / peak) for t, strength in raw]
